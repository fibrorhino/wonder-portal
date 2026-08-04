# Container image for Wonderwall. Used for the Azure deployment (App Service
# for Containers / Container Apps), and runnable anywhere Docker is.
#
#   docker build -t wonderwall .
#   docker run -p 3000:3000 -e GEMINI_API_KEY=... wonderwall
#
# Relies on `output: "standalone"` in next.config.ts, which emits a server.js
# that bundles only the node_modules it actually needs.

FROM node:22-slim AS build
WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Switches next.config.ts to output: "standalone" for this build only, so the
# default config keeps working with `next start` on the always-on host.
ENV BUILD_STANDALONE=1
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Bind to all interfaces: the platform's health probe and front end reach the
# container from outside, so listening on localhost only would fail.
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. node:22-slim ships a `node` user (uid 1000).
USER node

# standalone/ carries server.js plus the traced node_modules. `public` and
# `.next/static` are deliberately not included in it by Next, so copy them in.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
