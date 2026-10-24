# The online server's image. Built from the repo root (fly.toml sets this up), because the
# server bundles the rules engine and message types from web/src/.

# Stage 1: bundle server + engine into one plain JavaScript file.
FROM node:22-alpine AS build
WORKDIR /repo
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY server/ server/
COPY web/src/engine/ web/src/engine/
COPY web/src/protocol/ web/src/protocol/
RUN cd server && npm run build

# Stage 2: just Node, the server's runtime dependencies (Socket.IO) and the bundle.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /repo/server/dist/main.js ./main.js
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "main.js"]
