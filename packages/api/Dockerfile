FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack install --global pnpm@12.5.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm --filter @lyzer/api build

EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]
