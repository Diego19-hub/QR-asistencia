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
  assert.match(contents.css, /\.readable-interface \.text-xs\s*\{\s*font-size:\s*0\.9rem/);
  assert.match(contents.css, /\.readable-interface \.text-sm\s*\{\s*font-size:\s*0\.95625rem/);
  assert.match(contents.css, /\.readable-interface \.text-\\\[10px\\\]/);
  assert.match(contents.css, /\.readable-interface \.text-\\\[9px\\\]/);
});

test("small text scale is reduced by about ten percent without shrinking titles", async () => {
  const css = await readFile(files.css, "utf8");
  const expectedSizes = ["0.95625rem", "0.9rem", "0.84375rem", "0.7875rem"];
  for (const size of expectedSizes) assert.ok(css.includes(`font-size: ${size}`), `expected adjusted small-text size ${size}`);
  assert.doesNotMatch(css, /\.readable-interface\s+(?:h[1-6]|\.text-(?:xl|[2-6]xl))/);
});
