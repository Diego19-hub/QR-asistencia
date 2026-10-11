export const REPORT_PAGE_SIZE = 500;

export type CursorPageRequest = {
  afterId: string | null;
  pageSize: number;
  countOnly: boolean;
};

export type CursorPage<T> = {
  data: T[] | null;
  count: number | null;
  error: unknown | null;
};

export type CursorPageResult<T> =
  | { data: T[]; error: null }
  | { data: []; error: Error };

export async function fetchAllCursorPages<T extends { id: string }>(
  fetchPage: (request: CursorPageRequest) => Promise<CursorPage<T>>,
  pageSize = REPORT_PAGE_SIZE,
): Promise<CursorPageResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { data: [], error: new Error("El tamaño de página no es válido.") };
  }

  const rows: T[] = [];
  const seen = new Set<string>();
  let expectedCount = 0;
  let hasExpectedCount = false;
  let afterId: string | null = null;

  while (!hasExpectedCount || rows.length < expectedCount) {
    const page = await fetchPage({ afterId, pageSize, countOnly: false });
    if (page.error) return { data: [], error: asError(page.error) };
    if (!Array.isArray(page.data)) return { data: [], error: new Error("La página del reporte no devolvió filas.") };
    if (!hasExpectedCount) {
      if (!Number.isInteger(page.count) || (page.count ?? -1) < 0) {
        return { data: [], error: new Error("PostgREST no devolvió el conteo para validar la paginación.") };
      }
      expectedCount = page.count as number;
      hasExpectedCount = true;
    }

    const batch = page.data;
    if (rows.length + batch.length > expectedCount) {
      return { data: [], error: new Error("El conjunto cambió durante la paginación del reporte.") };
    }
    for (const row of batch) {
      if (typeof row.id !== "string" || !row.id) {
        return { data: [], error: new Error("Una fila del reporte no tiene identificador estable.") };
      }
      const id = row.id.toLowerCase();
      if (seen.has(id) || (afterId !== null && id <= afterId.toLowerCase())) {
        return { data: [], error: new Error("La paginación devolvió identificadores repetidos o fuera de orden.") };
      }
      seen.add(id);
      rows.push(row);
    }

    if (rows.length === expectedCount) break;
    if (batch.length === 0 || batch.length < pageSize) {
      return { data: [], error: new Error("La paginación terminó antes del conteo esperado.") };
    }
    afterId = batch[batch.length - 1].id;
  }

  const verification = await fetchPage({ afterId: null, pageSize: 0, countOnly: true });
  if (verification.error) return { data: [], error: asError(verification.error) };
  if (verification.count !== expectedCount || rows.length !== expectedCount || seen.size !== expectedCount) {
    return { data: [], error: new Error("El conteo cambió durante la consulta; vuelve a cargar el reporte.") };
  }

  return { data: rows, error: null };
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("No fue posible recuperar una página del reporte.");
}
