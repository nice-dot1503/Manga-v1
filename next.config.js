/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Page images are served via signed R2 URLs (see src/lib/storage/r2.ts),
  // so no remote image domains need to be whitelisted for next/image here
  // beyond your own R2 public host, once you wire that up.
};

module.exports = nextConfig;
