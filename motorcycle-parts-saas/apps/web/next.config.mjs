/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // while testing, a small type warning should not stop the production build
  typescript: { ignoreBuildErrors: true },
  // lets you open the dev site from a phone on the same Wi-Fi (npm run dev:lan)
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*'],
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }];
  },
};
export default nextConfig;
