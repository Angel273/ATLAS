import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.ATLAS_NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@atlas/contracts'],
  poweredByHeader: false,
  async rewrites() { return [{ source: '/api/v1/:path*', destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/v1/:path*` }]; },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ] }]; },
};
export default config;
