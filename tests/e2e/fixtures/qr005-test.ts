import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

import { guardBrowserOrigins, qr005Environment } from "../helpers/qr005-env.mjs";

type QR005Environment = {
  baseUrl: URL;
  supabaseUrl: URL;
  allowedOrigins: Set<string>;
  fixture: (name: string) => string;
  signIn: (page: Page, email: string, password: string) => Promise<void>;
  guardBrowserOrigins: (context: BrowserContext) => Promise<void>;
};

export const test = base.extend<{ qr: QR005Environment }>({
  qr: async ({ context }, applyFixture: (environment: QR005Environment) => Promise<void>) => {
    const environment = qr005Environment() as QR005Environment;
    await guardBrowserOrigins(context);
    await applyFixture(environment);
  },
});

export { expect };
