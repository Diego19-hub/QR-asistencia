import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  css: new URL("../src/app/globals.css", import.meta.url),
  admin: new URL("../src/components/admin/admin-shell.tsx", import.meta.url),
  login: new URL("../src/app/(auth)/login/page.tsx", import.meta.url),
  employee: new URL("../src/components/employee/employee-portal.tsx", import.meta.url),
};

test("readability scale is scoped to admin, login and employee portal", async () => {
  const [css, admin, login, employee] = await Promise.all(
    Object.entries(files).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
  );
  const contents = Object.fromEntries([css, admin, login, employee]);

  assert.match(contents.admin, /className="readable-interface [^"]*min-h-screen/);
  assert.match(contents.login, /className="readable-interface [^"]*min-h-screen/);
  assert.match(contents.employee, /className="readable-interface [^"]*min-h-screen/);
  assert.match(contents.css, /\.readable-interface \.text-xs\s*\{\s*font-size:\s*1rem/);
  assert.match(contents.css, /\.readable-interface \.text-sm\s*\{\s*font-size:\s*1\.0625rem/);
  assert.match(contents.css, /\.readable-interface \.text-\\\[10px\\\]/);
  assert.match(contents.css, /\.readable-interface \.text-\\\[9px\\\]/);
});
