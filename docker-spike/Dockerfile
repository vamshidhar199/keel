# Minimal spike: prove gbrain CLI runs in a Linux container against pgvector Postgres.
FROM oven/bun:1.1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/gbrain
RUN git clone --depth 1 https://github.com/garrytan/gbrain.git . \
  && bun install \
  && bun link

ENV PATH=/root/.bun/bin:$PATH

WORKDIR /work
COPY run-spike.sh /usr/local/bin/run-spike.sh
RUN chmod +x /usr/local/bin/run-spike.sh

CMD ["/usr/local/bin/run-spike.sh"]
