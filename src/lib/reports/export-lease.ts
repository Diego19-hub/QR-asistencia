type RpcError = { code?: string; message?: string } | null;

export interface ExportLeaseRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
}

export type ExportLeaseAcquire =
  | { acquired: true; lease: DistributedExportLease }
  | { acquired: false; retryAfterSeconds: number }
  | { acquired: false; error: RpcError };

const LEASE_SECONDS = 120;
const RENEW_EVERY_MS = 20_000;

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

export async function acquireDistributedExportLease(
  client: ExportLeaseRpcClient,
  companyId: string,
): Promise<ExportLeaseAcquire> {
  const ownerToken = globalThis.crypto.randomUUID();
  const { data, error } = await client.rpc("acquire_report_export_lease", {
    p_company_id: companyId,
    p_owner_token: ownerToken,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) return { acquired: false, error };
  const row = firstRow(data);
  if (!row || typeof row.acquired !== "boolean") return { acquired: false, error: { message: "invalid lease response" } };
  if (!row.acquired) {
    const retryAfterSeconds = Number(row.retry_after_seconds);
    return { acquired: false, retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds)) : LEASE_SECONDS };
  }
  const lease = new DistributedExportLease(client, companyId, ownerToken);
  lease.startHeartbeat();
  return { acquired: true, lease };
}

/**
 * Keeps the database lease alive while generating and streaming the completed
 * file. The owner UUID is never sent to the browser and all renew/release calls
 * are additionally bound to the authenticated user and company in SQL.
 */
export class DistributedExportLease {
  private readonly client: ExportLeaseRpcClient;
  private readonly companyId: string;
  private readonly ownerToken: string;
  private timer: ReturnType<typeof setInterval> | undefined;
  private renewal: Promise<boolean> | undefined;
  private releaseTask: Promise<void> | undefined;
  private lost = false;

  constructor(client: ExportLeaseRpcClient, companyId: string, ownerToken: string) {
    this.client = client;
    this.companyId = companyId;
    this.ownerToken = ownerToken;
  }

  get isHeld() { return !this.lost && !this.releaseTask; }

  startHeartbeat() {
    this.timer = setInterval(() => { void this.renew(); }, RENEW_EVERY_MS);
    this.timer.unref?.();
  }

  async renew(): Promise<boolean> {
    if (!this.isHeld) return false;
    if (this.renewal) return this.renewal;
    this.renewal = (async () => {
      try {
        const { data, error } = await this.client.rpc("renew_report_export_lease", {
          p_company_id: this.companyId,
          p_owner_token: this.ownerToken,
          p_lease_seconds: LEASE_SECONDS,
        });
        const renewed = !error && data === true;
        if (!renewed) this.lost = true;
        return renewed;
      } catch {
        this.lost = true;
        return false;
      }
    })().finally(() => { this.renewal = undefined; });
    return this.renewal;
  }

  async release(): Promise<void> {
    if (this.releaseTask) return this.releaseTask;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.releaseTask = (async () => {
      await this.renewal?.catch(() => false);
      try {
        await this.client.rpc("release_report_export_lease", {
          p_company_id: this.companyId,
          p_owner_token: this.ownerToken,
        });
      } catch {
        // The database expiry is the recovery path if Postgres is unavailable.
      }
    })();
    return this.releaseTask;
  }

  /** Transfer ownership of release to the response stream until it is consumed or canceled. */
  createResponseBody(file: Buffer): ReadableStream<Uint8Array> {
    let chunk: Uint8Array | undefined = file;
    const isLeaseHeld = () => this.isHeld;
    const releaseLease = () => this.release();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!isLeaseHeld()) {
          chunk = undefined;
          controller.error(new Error("Export lease was lost"));
          await releaseLease();
          return;
        }
        if (chunk) {
          controller.enqueue(chunk);
          chunk = undefined;
          return;
        }
        await releaseLease();
        controller.close();
      },
      async cancel() {
        chunk = undefined;
        await releaseLease();
      },
    });
  }
}
