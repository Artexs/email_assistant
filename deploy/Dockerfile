FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
# Dev dependencies stay: dbmate and kysely-codegen are needed for db:migrate
RUN bun install --frozen-lockfile

COPY apps/server apps/server
COPY packages/core packages/core
COPY db db
COPY tsconfig.base.json ./

USER bun
EXPOSE 8080
CMD ["bun", "apps/server/src/main.ts"]
