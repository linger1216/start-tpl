# 四个构建目标(默认 runtime):
#
#   deps     —— 装依赖(含 devDependencies),给 build / dev 复用
#   build    —— 编译出 `.output`(Nitro node-server)
#   dev      —— 源码 + 全部依赖 + git,给 .devcontainer 与 compose 的初始化任务用
#   runtime  —— 生产镜像:`.output` + **生产依赖**
#
# 为什么运行镜像还要装一遍依赖(踩过的坑,不是偷懒):
#   Nitro 的 node-server 产物**不是自包含的**。`pnpm build` 的最后一步是
#   `cp instrument.server.mjs .output/server`,这个文件是**原样拷贝、不过打包器**的,
#   而它第一行就是 `import * as Sentry from '@sentry/tanstackstart-react'`。
#   只 COPY `.output` 的镜像启动即崩:
#     Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@sentry/tanstackstart-react'
#     imported from .output/server/instrument.server.mjs
#   实测带上生产依赖后:`/` → 307、`/api/auth/ok` → 200、`POST /api/auth/sign-in/email` → 200。
#
# 构建期**不**注入 `.env.local`(也不给哑 `DATABASE_URL`):
#   `VITE_*` 会被编译进前端产物,机密不该进镜像;运行期环境变量由 `docker run -e` /
#   compose 注入(`pnpm start` 本来就不读任何 env 文件)。
#   实测 `vite build` 不会评估 `src/db/index.ts` —— 在**没有** `.env.local`、
#   **没有** `DATABASE_URL` 的仓库副本里构建成功(exit 0,产 `.output/nitro.json`),
#   所以构建阶段不需要任何机密或占位值。
#
# 构建:
#   docker build --target runtime -t start-tpl:local .
# 运行:
#   docker run --rm -p 3000:3000 --env-file .env.local start-tpl:local

# ── 依赖 ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV XDG_DATA_HOME=/pnpm/.data
ENV PATH=$PNPM_HOME:$PATH
# 显式钉死 store 位置:项目里的 `.npmrc`(若存在)可能写着宿主机绝对路径
ENV npm_config_store_dir=/pnpm/.data/pnpm/store
# corepack 下载 pnpm 时不交互(CI / 容器里没有 TTY)
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# 只拷清单:改源码不会导致重装依赖
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── 构建产物 ───────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm build

# ── 开发镜像(devcontainer / 初始化任务)────────────────────────────
FROM deps AS dev
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "dev"]

# ── 生产镜像 ───────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV PNPM_HOME=/pnpm
ENV XDG_DATA_HOME=/pnpm/.data
ENV PATH=$PNPM_HOME:$PATH
ENV npm_config_store_dir=/pnpm/.data/pnpm/store
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/.output ./.output
EXPOSE 3000
# 健康检查走 Better Auth 的 `/api/auth/ok`(不需要登录,实测 200)。
# 用 node 自带的 fetch,不额外装 curl。
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/ok').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "./.output/server/instrument.server.mjs", ".output/server/index.mjs"]
