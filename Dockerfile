FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM oven/bun:1.4.2-alpine AS authority
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN bun install --production --frozen-lockfile
COPY src/sim src/sim
COPY src/server src/server
COPY src/agent src/agent
COPY scripts/server.ts scripts/authority-admin.ts scripts/
EXPOSE 3000
CMD ["bun", "scripts/server.ts"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 3000
