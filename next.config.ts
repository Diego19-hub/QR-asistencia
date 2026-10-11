import type { NextConfig } from "next";

// Set this to the exact host issued by Cloudflare Tunnel (without https://).
// A precise allowlist keeps Next.js development and Server Action origin checks on.
const tunnelHost = process.env.NEXT_ALLOWED_DEV_ORIGIN?.trim();
const allowedTunnelHosts = tunnelHost ? [tunnelHost] : [];

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedTunnelHosts,
  experimental: {
    serverActions: {
      allowedOrigins: allowedTunnelHosts,
    },
  },
};

export default nextConfig;
