# Exact Node release and Docker Official Image index digest keep build and
# runtime reproducible and ABI-compatible (including native modules like argon2).
# Public Supabase values are baked into browser bundles and must target Testing.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" \
  && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  && NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
     npm run build

# Verify the standalone trace contains PDFKit and its runtime font metrics.
RUN node -e 'const fs=require("node:fs");const path=require("node:path");const entry=path.join(process.cwd(),".next/standalone/node_modules/pdfkit");const afm=path.join(entry,"js","data","Helvetica.afm");if(!fs.existsSync(afm))throw new Error("PDFKit AFM asset missing from standalone output");if(!fs.existsSync(path.join(process.cwd(),".next/standalone/server.js")))throw new Error("Next standalone server missing");'
# Next copies the root package manifest into standalone output. Remove developer
# scripts and dev dependency metadata from the production artifact.
RUN node -e 'const fs=require("node:fs");const file=".next/standalone/package.json";const pkg=JSON.parse(fs.readFileSync(file,"utf8"));delete pkg.scripts;delete pkg.devDependencies;delete pkg.overrides;fs.writeFileSync(file,JSON.stringify(pkg)+"\n");'

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=2048
WORKDIR /app

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3000/api/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["node", "server.js"]
