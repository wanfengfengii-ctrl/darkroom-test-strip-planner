# 内置 Chromium 与系统依赖的 Playwright 官方镜像（标签版本与 @playwright/test 对齐）
FROM mcr.microsoft.com/playwright:v1.56.0-noble

# 安装阶段使用 root，避免 /app 目录属主导致 npm ci 无法写入
USER root
WORKDIR /app

# 中文字体，保证页面中文在容器（含 Playwright 截图）中正常渲染
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# 先拷贝依赖清单以利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 运行时降权为镜像内置的非 root 用户
RUN chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
