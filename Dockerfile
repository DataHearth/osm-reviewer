# syntax=docker/dockerfile:1.27

# Pinned by digest, not just by tag: a tag is mutable, so a tag-only pin means the bytes
# that ship can change without a commit — and grype's findings drift between builds
# independently of our code. The version matches the nodejs in the flake's nixpkgs, so the
# image and the Nix package run the same node. Refresh with
# `docker buildx imagetools inspect node:<version>-alpine --format '{{.Manifest.Digest}}'`.
#
# TRAP: the digest is what resolves — bumping NODE_VERSION alone silently keeps building
# the old image. Bump both.
ARG NODE_VERSION=24.20.0
ARG NODE_DIGEST=sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

# The build output is plain JS, so it is built once on the runner's own platform even for
# a multi-arch image; only the production install below runs per target architecture.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine@${NODE_DIGEST} AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:${NODE_VERSION}-alpine@${NODE_DIGEST} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

FROM node:${NODE_VERSION}-alpine@${NODE_DIGEST}
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/osm-reviewer.db
# The digest pin holds the base layer steady; it must not hold back security fixes, so
# what apk tracks (openssl among it) is upgraded on top. Node itself is not an apk
# package — a node CVE means bumping NODE_VERSION and NODE_DIGEST.
#
# The server runs on node alone. The package managers the base image bundles are never
# called at runtime, and their vendored dependencies are where the scanner finds fixable
# CVEs, so they go rather than wait for an upstream image bump.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && mkdir /data && chown node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
VOLUME ["/data"]
# Numeric, so Kubernetes' runAsNonRoot can verify it without resolving a name; it is the
# base image's `node` user, and the chart's securityContext runs as the same uid.
USER 1000:1000
EXPOSE 3000
CMD ["node", "build/index.js"]
