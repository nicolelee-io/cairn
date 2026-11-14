# syntax=docker/dockerfile:1
# Debian slim, not Alpine: sharp and better-sqlite3 ship glibc prebuilt binaries.
FROM node:24-bookworm-slim AS build
# Baked into the web bundle (Settings > About, the update notice). Only the final build step reads
# them, so a new commit doesn't redo the dependency install.
ARG GIT_SHA=dev
ARG BUILD_DATE=
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci --ignore-scripts
COPY . .
RUN GIT_SHA=$GIT_SHA BUILD_DATE=$BUILD_DATE npm run build

# Production dependencies only. The bundle inlines everything except the native modules
# (better-sqlite3, @node-rs/argon2, sharp), which are loaded from here.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
# --ignore-scripts: better-sqlite3 ships prebuilt binaries (no compile step, no Python/make in the
# slim image), and install scripts of production deps shouldn't run during the build anyway.
RUN npm ci --omit=dev --ignore-scripts --workspace=@cairn/server --include-workspace-root=false

FROM node:24-bookworm-slim
ARG GIT_SHA=dev
ARG BUILD_DATE=
# glibc gives each of sharp's worker threads its own malloc arena and rarely hands the memory back,
# so RSS stayed hundreds of MB up after processing photos. Two arenas roughly halved peak and settled
# RSS in a local 12 MP test (small home servers are often short on RAM).
ENV MALLOC_ARENA_MAX=2
ENV NODE_ENV=production \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE} \
    PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/drizzle \
    DATA_DIR=/data
WORKDIR /app
# The server is one esbuild bundle; native modules (better-sqlite3, argon2, sharp) load from node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist/index.js ./server.js
# Importer CLI (Day One and Cairn zips): docker exec -i cairn node import-journal.js - < Export.zip
COPY --from=build /app/apps/server/dist/import-journal.js ./import-journal.js
# Password reset CLI: docker exec -it cairn node reset-password.js <username>
COPY --from=build /app/apps/server/dist/reset-password.js ./reset-password.js
# No admin left (hand-edited DB, old restore): docker exec -i cairn node make-admin.js <username>
COPY --from=build /app/apps/server/dist/make-admin.js ./make-admin.js
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./web
# Created and chowned before the volume is mounted so cairn_data inherits node ownership.
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
