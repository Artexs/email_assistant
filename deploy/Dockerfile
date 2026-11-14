FROM oven/bun:1.4.4

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY tools/fake-telegram/package.json tools/fake-telegram/package.json
# Dev dependencies stay: dbmate and kysely-codegen are needed for db:migrate
RUN bun install --frozen-lockfile

COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/core packages/core
COPY db db
COPY evals/cases evals/cases
COPY tsconfig.base.json ./
# The web build writes into apps/web/dist, so it runs as root before USER bun
RUN bun run web:build
ENV WEB_DIST=/app/apps/web/dist

USER bun
EXPOSE 8080
CMD ["bun", "apps/server/src/main.ts"]
