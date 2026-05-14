import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
