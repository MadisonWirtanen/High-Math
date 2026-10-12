# ============================================================
# HighMath — Linux 服务器部署镜像
#
# 与桌面版共用同一份代码，只是启动方式不同。
#
# 构建：
#   docker build -t highmath .
#   docker build --build-arg INSTALL_PANDOC=1 -t highmath .   # 含 Word 导出
#
# 运行（挂载你的题库目录到 /data）：
#   docker run -d -p 3000:3000 -v /srv/mathbank:/data --name highmath highmath
#
# 浏览器打开 http://<服务器IP>:3000
# ============================================================

# ---------- 阶段一：构建 ----------
FROM node:22-alpine AS builder
WORKDIR /app

# 国内镜像加速（如需海外构建可删掉 --registry）
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

COPY . .
RUN npm run build


# ---------- 阶段二：运行 ----------
FROM node:22-alpine AS runner
WORKDIR /app

# Word 导出需要 pandoc（体积较大，默认不装）
ARG INSTALL_PANDOC=0
RUN if [ "$INSTALL_PANDOC" = "1" ]; then apk add --no-cache pandoc; fi

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# 题库目录：建议挂载卷到此路径
ENV VAULT_PATH=/data
# 题库子目录名（Obsidian Vault 模式）；若 /data 本身就是题库目录，改为 .
ENV BANK_DIR_NAME=题库

# Next standalone 产物（不会自动带 static / public，必须手动拷贝）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 示例题库（可选，想体验可设 VAULT_PATH=/app/demo-vault）
COPY --from=builder /app/demo-vault ./demo-vault

# 知识点总表（若仓库根目录存在则一并带上，用于知识点校验）
COPY --from=builder /app/*.md ./

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "server.js"]
