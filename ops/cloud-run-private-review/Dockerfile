# Candidate image only. Build from the REPOSITORY ROOT, never deploy directly.
# Runtime image MUST be promoted by immutable Artifact Registry sha256 digest
# and reviewed with vulnerability scanning before Terraform is applied.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv
COPY ops/cloud-run-private-review/package.json /srv/ops/cloud-run-private-review/package.json
RUN cd /srv/ops/cloud-run-private-review && \
    npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false
COPY cloudflare/account-deletion-audit/package.json /srv/cloudflare/account-deletion-audit/package.json
COPY cloudflare/account-deletion-audit/src /srv/cloudflare/account-deletion-audit/src
COPY ops/cloud-run-private-review/server.mjs /srv/ops/cloud-run-private-review/server.mjs
USER node
EXPOSE 8080
CMD ["node", "/srv/ops/cloud-run-private-review/server.mjs"]
