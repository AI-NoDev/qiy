FROM oven/bun:1.3.13 AS dependencies

WORKDIR /app
COPY package.json turbo.json ./
COPY apps ./apps
RUN bun install

# React Router's SPA mode removes this output after building, but its build
# pipeline still loads react-dom's server entry. On Linux, Bun currently fails
# on that CJS wrapper, so use Node only for the frontend build. The generated
# application still installs and runs its API solely on Bun.
FROM node:22-alpine AS web-build

WORKDIR /app
COPY --from=dependencies /app ./
RUN cd apps/web && node build.mjs

FROM oven/bun:1.3.13 AS runtime

WORKDIR /app
COPY --from=web-build /app /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/server", "start"]
