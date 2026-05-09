FROM oven/bun:1.1 AS deps
WORKDIR /app
COPY package.json bun.lockb* package-lock.json* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.1 AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install gbrain CLI and verify it's at the expected location
RUN BUN_INSTALL=/root/.bun bun install -g gbrain \
  && (test -x /root/.bun/bin/gbrain || \
      (FOUND=$(find / -name gbrain -type l 2>/dev/null -not -path "*/node_modules/*" | head -1) \
       && echo "gbrain found at $FOUND, linking..." \
       && mkdir -p /root/.bun/bin \
       && ln -sf "$FOUND" /root/.bun/bin/gbrain)) \
  && test -x /root/.bun/bin/gbrain \
  && echo "gbrain ready at /root/.bun/bin/gbrain"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUN_BIN=/root/.bun/bin
ENV PATH=/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["bun", "server.js"]
