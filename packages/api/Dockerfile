FROM node:26-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @lyzer/api build

EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]
