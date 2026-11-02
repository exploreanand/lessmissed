/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-hosted container build: emit a minimal standalone server at
  // .next/standalone/server.js that bundles only the files and node_modules
  // the server actually needs. The Dockerfile copies that rather than the
  // whole repo + node_modules.
  output: "standalone",

  // Don't advertise the framework in a response header.
  poweredByHeader: false,

  async headers() {
    return [
      {
        // The tag loads webgazer.js and its face-model files cross-origin from
        // a brand's own domain, so everything under /tag/v1 must be
        // CORS-readable. Without this the browser blocks the model fetch and
        // gaze silently dies on every brand site.
        // See public/tag/v1/lm.js (localModelUrl / loadWebGazer).
        source: "/tag/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
      {
        // lm.js changes whenever we ship a new tag. Short cache so brands pick
        // up a new version within minutes, while the edge still serves it fast.
        source: "/tag/v1/lm.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // webgazer.js and the model binaries are pinned by the /v1/ path and
        // never change in place, so cache them hard.
        source: "/tag/v1/webgazer.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, immutable" },
        ],
      },
      {
        source: "/tag/v1/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
