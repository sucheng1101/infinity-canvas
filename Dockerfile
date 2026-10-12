# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

# 默认 hosted 与发布镜像保持一致；本地二开可用 --build-arg VITE_APP_MODE=local 构建自管 API Key 的本地模式。
ARG VITE_APP_MODE=hosted
ENV VITE_APP_MODE=${VITE_APP_MODE}

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：只启动静态前端，AI 请求由浏览器前台直连用户自己的接口。
FROM nginx:1.27-alpine

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
# 构建上下文取的是工作区文件，Windows 上 core.autocrlf=true 会带入 CRLF，让脚本 shebang 失效（容器以 127 重启）。
# 这里统一去掉行尾 CR，保证任何检出状态下镜像都能正常启动。
RUN sed -i 's/\r$//' /etc/nginx/conf.d/default.conf /docker-entrypoint.d/40-runtime-config.sh \
    && chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 1010
