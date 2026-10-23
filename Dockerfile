# Container image for the copilot (root app). Used by `docker compose --profile app up` (see docs/RUNBOOK.md).
# Targets:
#   setup   runs migrations, the data load and grants once, as the owner login (npm run db:setup). Has dev tools.
#   runner  the production server. No dev dependencies, no owner URL, runs as the unprivileged "node" user.
# The same file builds the alerts app with `--build-arg APP_DIR=alerts`.
ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS deps
ARG APP_DIR=.
WORKDIR /app
COPY ${APP_DIR}/package.json ${APP_DIR}/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG APP_DIR=.
COPY ${APP_DIR}/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# App-specific folders read at run time: registry/ for the copilot, rules/ for alerts. Collected into one folder
# so the runner stage can copy whichever exist.
RUN mkdir -p runtime-files && for d in registry rules; do if [ -d "$d" ]; then cp -r "$d" runtime-files/; fi; done

# One-shot database setup. Needs MIGRATION_DATABASE_URL at run time.
FROM build AS setup
ENV NODE_ENV=production
CMD ["npx", "tsx", "scripts/db-setup.ts"]

FROM node:${NODE_VERSION} AS runner
ARG APP_DIR=.
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY ${APP_DIR}/package.json ${APP_DIR}/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# The server reads these at run time: the build, its config, and the registry, rules, data and migrations from disk.
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/data ./data
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/runtime-files ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start"]
