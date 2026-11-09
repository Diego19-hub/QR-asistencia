import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("native buttons receive consistent hover, pressed, keyboard focus, and disabled feedback", () => {
  assert.match(css, /button:not\(:disabled\):hover/);
  assert.match(css, /button:not\(:disabled\):active/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /button:disabled/);
});

test("administration, login and employee portal use a scoped readable text scale", async () => {
  assert.match(css, /\.readable-interface \.text-sm\s*\{\s*font-size:\s*0\.95625rem/s);
  assert.match(css, /\.readable-interface \.text-xs\s*\{\s*font-size:\s*0\.9rem/s);
  assert.match(css, /\.readable-interface \.text-\\\[10px\\\]/);
  assert.match(css, /\.readable-interface \.text-\\\[11px\\\]/);
  assert.match(css, /\.readable-interface \.text-\\\[9px\\\]/);
  assert.match(css, /\.readable-interface \.text-\\\[13px\\\]/);
  assert.match(await readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8"), /readable-interface/);
  assert.match(await readFile(new URL("../src/components/employee/employee-portal.tsx", import.meta.url), "utf8"), /readable-interface/);
  assert.match(await readFile(new URL("../src/app/(auth)/login/page.tsx", import.meta.url), "utf8"), /readable-interface/);
  assert.doesNotMatch(css, /\.readable-interface\s+(?:h[1-6]|\.text-(?:xl|[2-6]xl))/);
});

test("larger text retains horizontal navigation and invitation actions can wrap without clipping", async () => {
  const admin = await readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8");
  const employee = await readFile(new URL("../src/components/employee/employee-portal.tsx", import.meta.url), "utf8");
  const invitations = await readFile(new URL("../src/components/admin/user-access-management.tsx", import.meta.url), "utf8");
  assert.match(admin, /overflow-x-auto/);
  assert.match(employee, /grid grid-cols-5[\s\S]*?min-h-16[\s\S]*?text-\[9px\]/);
  assert.match(invitations, /min-h-10 h-auto[\s\S]*?text-\[11px\]/);
});

test("pressed motion respects reduced-motion preferences", () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /scale:\s*1/);
});
