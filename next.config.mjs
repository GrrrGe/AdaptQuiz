/** @type {import('next').NextConfig} */
const nextConfig = {
  // RAG/LLM libs are server-only Node packages (chromadb pulls optional
  // native/ML deps) — keep them external instead of webpack-bundling.
  experimental: {
    serverComponentsExternalPackages: [
      "chromadb",
      "@langchain/community",
      "@langchain/openai",
      "@langchain/core",
      "@langchain/textsplitters",
      "pdf-parse",
    ],
  },
};

export default nextConfig;
