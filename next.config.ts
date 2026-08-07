import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { publicSecurityHeaders } from './src/config/security-headers';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // (deploy pass) T-3 — security header + CSP sulla SUPERFICIE PUBBLICA `/s/:path*` (siti
  // pubblicati, letti da anon): difesa in profondita' oltre la sanificazione del renderer unico.
  // Il builder e' PURO/testabile in src/config/security-headers.ts; l'host Storage in `img-src`
  // e' derivato da NEXT_PUBLIC_SUPABASE_URL a build-time.
  async headers() {
    return [{ source: '/s/:path*', headers: publicSecurityHeaders() }];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
