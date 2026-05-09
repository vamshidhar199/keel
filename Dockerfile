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
    git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install gbrain CLI from the garrytan/gbrain GitHub repo (NOT the unrelated npm package).
# Pinned to a specific commit so upstream changes can't break our builds.
ARG GBRAIN_SHA=c2ae4dbfc58d826c4982139d4b685399c0fdd68e
RUN git clone https://github.com/garrytan/gbrain.git /opt/gbrain \
  && cd /opt/gbrain && git checkout "$GBRAIN_SHA" && bun install \
  && CLI=/opt/gbrain/src/cli.ts \
  && test -f "$CLI" || (echo "ERROR: $CLI not found" && find /opt/gbrain -name "cli.ts" && exit 1) \
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
