ARG NODE_IMAGE
ARG CREW_IMAGE
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
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=web /app/birbforge /app/birbforge
COPY delivery /app/birbforge/delivery
RUN chmod -R a+rX /app/birbforge
WORKDIR /app/birbforge
ENV PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["node", "node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.node.json", "server/main.ts"]
