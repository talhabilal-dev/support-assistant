# Multi-stage build for the Support Assistant backend.
#
# The compiled SPA in ./public is taken from the build context rather than built
# here: the frontend source is deliberately not tracked in git, so a build from a
# clean clone would not have it. Build it on the machine that holds the source:
#
#     cd frontend && pnpm build      # -> ../public
#
# Migrations are NOT run by this image: the runtime stage installs production
# dependencies only, so drizzle-kit is not present. Apply migrations before
# deploying a new image (see docker-compose.yml).

# ---- build ---------------------------------------------------------------
FROM node:22-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---- production dependencies --------------------------------------------
FROM node:22-slim AS prod-deps

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime -------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# package.json is required at runtime: it carries "type": "module" for dist/.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
COPY emails ./emails

RUN test -f public/index.html \
    || { echo "ERROR: public/index.html is missing — build the SPA first: cd frontend && pnpm build"; exit 1; }

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
