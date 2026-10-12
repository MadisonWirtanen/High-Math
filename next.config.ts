import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 产出可独立分发的 standalone 产物（桌面壳与 Linux 服务器部署共用）
  output: "standalone",

  // 排除与运行无关的目录，避免 standalone 打包时被无谓地追踪/拷贝
  // （尤其是 desktop/ 与 .cache/，否则构建会明显变慢、产物虚胖）
  // 注意：不要排除 **/*.md —— 示例题库 demo-vault 就是 markdown，
  //       排除后 standalone 产物会缺少示例题。
  outputFileTracingExcludes: {
    "*": [
      "desktop/**",
      ".cache/**",
      "docs/**",
      "scripts/**",
      "**/*.tsbuildinfo",
    ],
  },

  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
