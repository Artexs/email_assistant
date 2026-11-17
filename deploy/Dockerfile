FROM oven/bun:1.4.4

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY tools/fake-telegram/package.json tools/fake-telegram/package.json
# Dev dependencies stay: dbmate and kysely-codegen are needed for db:migrate.
# The docs app stays out of the image: its Starlight tree is not needed to serve the panel (F112 D13).
RUN bun install --frozen-lockfile --filter "!@ea/docs"

COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/core packages/core
COPY db db
COPY evals/cases evals/cases
# The server reads the gate files at start (F110 D1); a missing folder is only a warning, so keep this line.
COPY evals/results/gate evals/results/gate
COPY tsconfig.base.json ./
# The web build writes into apps/web/dist, so it runs as root before USER bun
RUN bun run web:build
ENV WEB_DIST=/app/apps/web/dist

# The release name (deploy/release.sh passes the tag). The server stamps it on every JSON log line (F114 D10).
# It comes after the build steps, so a new tag keeps their cache.
ARG EA_RELEASE=dev
ENV EA_RELEASE=$EA_RELEASE

USER bun
EXPOSE 8080
CMD ["bun", "apps/server/src/main.ts"]
