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

# Install gbrain CLI — bun -g install doesn't reliably create the bin symlink,
# so we find cli.ts directly and link it ourselves.
RUN BUN_INSTALL=/root/.bun bun install -g gbrain \
  && CLI=$(find / -path "*/gbrain/src/cli.ts" 2>/dev/null | head -1) \
  && [ -n "$CLI" ] || (echo "ERROR: gbrain cli.ts not found" && find / -iname "*gbrain*" 2>/dev/null && exit 1) \
  && chmod +x "$CLI" \
  && mkdir -p /root/.bun/bin \
  && ln -sf "$CLI" /root/.bun/bin/gbrain \
  && test -L /root/.bun/bin/gbrain \
  && echo "gbrain ready: /root/.bun/bin/gbrain -> $CLI"

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
