import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    // Admin surfaces were consolidated under /admin. Keep old bookmarks working.
    return [
      { source: "/settings", destination: "/admin", permanent: false },
      { source: "/ontology", destination: "/admin/ontology", permanent: false },
      { source: "/domains", destination: "/admin/domains", permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Link",
            value:
              '</llms.txt>; rel="describedby"; type="text/markdown", </agents.txt>; rel="ai-policy"; type="text/markdown"',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
