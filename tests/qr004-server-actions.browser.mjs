import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const chromeCandidates = [
  process.env.QR004_CHROME_BIN,
  process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : null,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error("QR-004 dynamic Server Actions require local Chrome/Chromium; set QR004_CHROME_BIN to an installed browser executable");
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function stopChrome(child) {
  const waitForExit = async (timeout) => {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return Promise.race([
      new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
      new Promise((resolveWait) => setTimeout(() => resolveWait(false), timeout)),
    ]);
  };
  let stopped = child.exitCode !== null || child.signalCode !== null;
  if (!stopped) {
    child.kill("SIGTERM");
    stopped = await waitForExit(5_000);
  }
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    stopped = await waitForExit(3_000);
  }
  if (!stopped) throw new Error("temporary Chrome process did not stop");
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools connection failed")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message.id) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(`Chrome DevTools command failed: ${message.error.message}`));
    else item.resolve(message.result ?? {});
  });
  return {
    async call(method, params = {}) {
      await ready;
      const id = ++nextId;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const entries = listeners.get(method) ?? new Set();
      entries.add(listener);
      listeners.set(method, entries);
      return () => entries.delete(listener);
    },
    close() { socket.close(); },
  };
}

export async function launchServerActionBrowser(appUrl) {
  const chrome = await findChrome();
  const debugPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "qr004-actions-chrome-"));
  const output = [];
  const chromeArgs = [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--disable-component-update", "--disable-sync", "--disable-extensions", "--disable-default-apps",
    "--disable-features=MediaRouter", "--disable-dev-shm-usage", "--no-zygote", "--remote-allow-origins=*",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1",
    "about:blank",
  ];
  // GitHub's hosted runner may block Chrome's user-namespace sandbox. Keep
  // the sandbox enabled for local runs; CI's ephemeral VM also blocks DNS.
  if (process.env.QR004_CHROME_NO_SANDBOX === "1") chromeArgs.unshift("--no-sandbox");
  const child = spawn(chrome, chromeArgs, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  let browser, page;
  try {
    const deadline = Date.now() + 20_000;
    let version;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        const diagnostic = output.join("").split("\n").slice(-8).join(" ").replace(/\s+/g, " ").slice(0, 500);
        throw new Error(`Chrome exited before the local browser session started${diagnostic ? `: ${diagnostic}` : ""}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (response.ok) { version = await response.json(); break; }
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.ok(version?.webSocketDebuggerUrl, "Chrome DevTools endpoint is ready");
    browser = connect(version.webSocketDebuggerUrl);
    const target = await browser.call("Target.createTarget", { url: "about:blank" });
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await targetResponse.json();
    const targetInfo = targets.find((item) => item.id === target.targetId);
    assert.ok(targetInfo?.webSocketDebuggerUrl, "isolated Chrome page target is available");
    page = connect(targetInfo.webSocketDebuggerUrl);
    await page.call("Page.enable");
    await page.call("Runtime.enable");
    await page.call("Network.enable");
    const origin = new URL(appUrl).origin;
    assert.equal(origin, appUrl.replace(/\/$/, ""), "the browser target uses only the local application origin");

    async function evaluate(expression) {
      const result = await page.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) throw new Error("Local browser evaluation failed while interacting with a rendered form");
      return result.result?.value;
    }
    async function waitFor(expression, message, timeout = 15_000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await evaluate(expression)) return;
        if (child.exitCode !== null) throw new Error("Chrome exited during the local Server Actions run");
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      const finalUrl = await evaluate("location.pathname + location.search").catch(() => "unavailable");
      throw new Error(`${message} (final local path: ${String(finalUrl).slice(0, 160)})`);
    }
    async function navigate(path) {
      const targetUrl = new URL(path, origin);
      assert.equal(targetUrl.origin, origin, "test navigation must remain on the local Next.js origin");
      await page.call("Page.navigate", { url: targetUrl.href });
      await waitFor("document.readyState === 'complete'", "local page did not finish loading");
    }
    async function runForm(selector, values = {}) {
      const encoded = JSON.stringify(values).replaceAll("<", "\\u003c");
      const expression = `(() => { const form = document.querySelector(${JSON.stringify(selector)}); if (!(form instanceof HTMLFormElement)) throw new Error('rendered form missing'); const values = ${encoded}; for (const [name, value] of Object.entries(values)) { const fields = [...form.elements].filter((field) => field.name === name); if (!fields.length) throw new Error('rendered field missing'); fields[0].value = value; } const submit = form.querySelector('button[type=submit],button:not([type])'); if (submit instanceof HTMLButtonElement) submit.disabled = false; form.requestSubmit(submit ?? undefined); return true; })()`;
      const actionResult = new Promise((resolveAction, rejectAction) => {
        let requestId;
        const timeout = setTimeout(() => { cleanup(); rejectAction(new Error("Next.js Server Action form did not complete locally")); }, 20_000);
        const cleanup = () => { clearTimeout(timeout); offRequest(); offResponse(); offFailed(); };
        const offRequest = page.on("Network.requestWillBeSent", (event) => {
          if (event.request.method === "POST" && new URL(event.request.url).origin === origin) requestId = event.requestId;
        });
        const offResponse = page.on("Network.responseReceived", (event) => {
          if (event.requestId === requestId) {
            cleanup();
            if (event.response.status >= 500) rejectAction(new Error(`Next.js returned HTTP ${event.response.status} for a local Server Action`));
            else resolveAction(true);
          }
        });
        const offFailed = page.on("Network.loadingFailed", (event) => {
          if (event.requestId === requestId) { cleanup(); rejectAction(new Error(`Next.js Server Action request failed locally (${String(event.errorText ?? "network failure").slice(0, 100)})`)); }
        });
      });
      const submitted = evaluate(expression);
      const [didSubmit] = await Promise.all([submitted, actionResult]);
      assert.equal(didSubmit, true, "browser submitted a Next-rendered Server Action form");
    }
    async function waitForPath(pathPart, message = `browser did not navigate to ${pathPart}`) {
      await waitFor(`location.origin === ${JSON.stringify(origin)} && (location.pathname + location.search + location.hash).includes(${JSON.stringify(pathPart)})`, message);
      const current = await evaluate("location.href");
      assert.equal(new URL(current).origin, origin, "Server Action redirect remains local");
      return current;
    }
    async function click(selector) {
      const result = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!(element instanceof HTMLElement)) throw new Error('rendered control missing'); if (element instanceof HTMLButtonElement) element.disabled = false; element.click(); return true; })()`);
      assert.equal(result, true, "browser activated a rendered control");
    }
    async function clickButtonText(text) {
      const result = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.innerText.trim().includes(${JSON.stringify(text)})); if (!(button instanceof HTMLButtonElement)) throw new Error('rendered button missing'); button.disabled = false; button.click(); return true; })()`);
      assert.equal(result, true, "browser activated a rendered button");
    }
    async function bodyText() { return evaluate("document.body.innerText"); }
    async function getCookies() {
      const result = await page.call("Network.getAllCookies");
      return result.cookies.filter((cookie) => cookie.domain.includes(new URL(origin).hostname));
    }
    async function fetchJson(path) {
      const targetUrl = new URL(path, origin);
      assert.equal(targetUrl.origin, origin, "browser API probe must stay on the local Next.js origin");
      return evaluate(`fetch(${JSON.stringify(targetUrl.pathname + targetUrl.search)}, { cache: 'no-store' }).then(async r => ({ status: r.status, body: await r.json() }))`);
    }
    return {
      navigate, runForm, click, clickButtonText, waitForPath, bodyText, getCookies, fetchJson,
      evaluate,
      currentUrl: () => evaluate("location.href"),
      close: async () => {
        try { await browser?.call("Browser.close"); } catch {}
        page?.close();
        browser?.close();
        try { await stopChrome(child); }
        finally { await rm(profile, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 }); }
      },
    };
  } catch (error) {
    try { await browser?.call("Browser.close"); } catch {}
    page?.close();
    browser?.close();
    try { await stopChrome(child); } catch {}
    await rm(profile, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 }).catch(() => {});
    throw error;
  }
}
