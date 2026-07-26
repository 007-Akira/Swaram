# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV COREPACK_HOME=/tmp/corepack
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @swaram/web build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN addgroup --system --gid 10001 swaram \
    && adduser --system --uid 10001 --ingroup swaram swaram
WORKDIR /app
COPY --from=builder --chown=swaram:swaram /app/apps/web/.next/standalone ./
COPY --from=builder --chown=swaram:swaram /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=swaram:swaram /app/apps/web/public ./apps/web/public
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
