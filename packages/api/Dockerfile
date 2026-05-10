FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile=false

COPY . .
RUN pnpm --filter @lyzer/api build

EXPOSE 3000
CMD ["pnpm", "--filter", "@lyzer/api", "start"]
