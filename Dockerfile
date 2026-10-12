# Build and runtime use the same Node 22 Debian base so native modules such as
# argon2, when present, remain ABI-compatible. Public Supabase values are baked
# into browser bundles by Next.js and must target Testing for this image.
FROM node:22-bookworm-slim AS build
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

# Verify PDFKit's built-in font metrics are available in the build dependency
# tree. The runtime image copies the complete production node_modules tree.
RUN node -e 'const fs=require("node:fs");const path=require("node:path");const entry=require.resolve("pdfkit");const afm=path.join(path.dirname(entry),"data","Helvetica.afm");if(!fs.existsSync(afm))throw new Error("PDFKit AFM asset missing");'
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=2048
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3000/api/healthz").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
