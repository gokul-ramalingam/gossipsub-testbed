# JS peer of the gossipsub testbed.
#
# Two stages: the deps stage installs the production dependencies from the
# lockfile; the runtime stage has only the code and those dependencies, and
# runs as the non-root user node. The base image is pinned by tag and digest,
# so that a rebuild uses the same image. Alpine is enough: no dependency has
# native code or an install script.

# --- dependencies ---
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# The exact versions of the lockfile, without the dev tools (ESLint, Prettier)
# and without install scripts.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# --- runtime ---
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

ENV NODE_ENV=production

WORKDIR /app

# The files stay owned by root, so the peer cannot change its own code.
COPY --from=deps /app/node_modules ./node_modules
# package.json: the started event reads the dependency versions from it.
COPY package.json ./
COPY src ./src

USER node

# libp2p (P2P_PORT) and the HTTP API (HTTP_PORT), the defaults of the peer.
EXPOSE 4001 8080

# node is PID 1 and gets SIGTERM directly; src/index.js stops the HTTP API and
# the p2p layer on it.
CMD ["node", "src/index.js"]
