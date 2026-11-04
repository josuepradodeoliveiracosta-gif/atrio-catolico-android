# Read-only candidate. Build from repository root; NO push or deployment.
# Base tag is still mutable: final image must be pinned by reviewed digest.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv
COPY ops/cloud-run-private-review/package.json ops/cloud-run-private-review/package-lock.json /srv/ops/cloud-run-private-review/
RUN cd /srv/ops/cloud-run-private-review && \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY cloudflare/account-deletion-audit/package.json /srv/cloudflare/account-deletion-audit/package.json
COPY cloudflare/account-deletion-audit/src /srv/cloudflare/account-deletion-audit/src
COPY ops/cloud-run-private-review/server.mjs /srv/ops/cloud-run-private-review/server.mjs
USER node
EXPOSE 8080
CMD ["node", "/srv/ops/cloud-run-private-review/server.mjs"]
