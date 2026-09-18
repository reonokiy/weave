ARG GTS_IMAGE=docker.io/superseriousbusiness/gotosocial:0.22.1
FROM ${GTS_IMAGE} AS upstream

FROM node:22-alpine AS builder
WORKDIR /work
COPY package.json pnpm-lock.yaml ./
RUN npx --yes pnpm@11.25.0 install --frozen-lockfile
COPY . .
RUN npx pnpm@11.25.0 build
COPY --from=upstream /gotosocial/web /upstream-web
RUN GTS_WEB=/upstream-web node scripts/gts-bundle.mjs

FROM upstream AS weave
COPY --from=builder --chown=1000:1000 /work/artifacts/gts-web/template /gotosocial/web/template
COPY --from=builder --chown=1000:1000 /work/artifacts/gts-web/assets/weave /gotosocial/web/assets/weave
COPY --from=builder --chown=1000:1000 /work/artifacts/gts-web/weave-bundle.json /gotosocial/web/weave-bundle.json
LABEL org.opencontainers.image.title="Weave for GoToSocial"
