/** @type {import('next').NextConfig} */
const nextConfig = {
  // knowledge/*.md is read at runtime with fs; make sure Vercel ships it with the API routes.
  outputFileTracingIncludes: {
    '/api/**/*': ['./knowledge/**/*'],
    '/setup': ['./knowledge/**/*'],
  },
};
export default nextConfig;
