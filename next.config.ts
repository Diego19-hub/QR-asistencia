import type { NextConfig } from "next";

// Set this to the exact host issued by Cloudflare Tunnel (without https://).
// A precise allowlist keeps Next.js development and Server Action origin checks on.
const tunnelHost = process.env.NEXT_ALLOWED_DEV_ORIGIN?.trim();
const allowedTunnelHosts = tunnelHost ? [tunnelHost] : [];

const nextConfig: NextConfig = {
  // Generate a traced runtime package for Docker instead of copying the full
  // production node_modules tree into the final image.
  output: "standalone",
  // PDFKit loads AFM files by path at runtime; include those assets in the
  // traced export route so PDF generation keeps working in the minimal image.
  outputFileTracingIncludes: {
    "/api/reports/export": ["./node_modules/pdfkit/js/data/**/*"],
  },
  allowedDevOrigins: allowedTunnelHosts,
  // PDFKit resolves AFM font files relative to its own package directory.
  // Keeping it external preserves that runtime path in the compiled route.
  serverExternalPackages: ["pdfkit"],
  experimental: {
    serverActions: {
      allowedOrigins: allowedTunnelHosts,
    },
  },
};

export default nextConfig;
