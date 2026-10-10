FROM oven/bun:1.3.13 AS build

WORKDIR /app
COPY package.json bun.lock turbo.json ./
COPY apps ./apps
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3.13 AS runtime

WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/server", "start"]
