ARG NODE_IMAGE
ARG CREW_IMAGE
ARG RUST_IMAGE
FROM ${RUST_IMAGE} AS beans
ARG BEANS_REPOSITORY=https://github.com/mattsp1290/beans.git
ARG BEANS_COMMIT=bb55b2aa253a63cb18d8e4357ca8958d3fd5ad0b
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /src/beans
RUN git init -q . && git fetch -q --depth 1 "$BEANS_REPOSITORY" "$BEANS_COMMIT" \
  && git checkout -q --detach FETCH_HEAD && test "$(git rev-parse HEAD)" = "$BEANS_COMMIT"
# Build with the image's toolchain; the repository's toolchain file would otherwise download extra components.
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/beans/target \
  RUSTUP_TOOLCHAIN="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)" RUSTUP_AUTO_INSTALL=0 \
  BN_VERSION="v$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -n 1)+$BEANS_COMMIT" \
  cargo build --release --locked --bin bn && install -m 0755 target/release/bn /bn

FROM ${NODE_IMAGE} AS web
WORKDIR /app/birbforge
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app ./app
COPY server ./server
COPY app.json metro.config.cjs tsconfig.json tsconfig.node.json ./
RUN npm run check && npm run export:web

FROM ${CREW_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates git tini && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=beans /bn /usr/local/bin/bn
COPY --from=web /app/birbforge /app/birbforge
COPY delivery /app/birbforge/delivery
COPY scripts/chat-agent.py /app/birbforge/scripts/chat-agent.py
RUN chmod -R a+rX /app/birbforge
WORKDIR /app/birbforge
ENV PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10001:10001
# The gateway runs bn, git and Python children; tini forwards signals and reaps orphaned grandchildren.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.node.json", "--import", "./server/tracing.mjs", "server/main.ts"]
