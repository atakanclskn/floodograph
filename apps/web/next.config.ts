import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // the pilot analysis map and the whole-city view were folded into İstanbul (/sinema) and İzmir (/izmir)
  async redirects() {
    return [
      { source: "/demo", destination: "/sinema", permanent: false },
      { source: "/sehirler", destination: "/izmir", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
