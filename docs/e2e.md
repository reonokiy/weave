# GoToSocial integration tests

Tests target GoToSocial **0.22.1** using its release binary or a derived image containing replacement templates and assets.

## Reproduce using Docker

Use Node.js 22.12+, pnpm 11, and Docker. Ports 8686 and 8687 must be free.

```sh
pnpm install
pnpm exec playwright install chromium
docker build -t weave-gotosocial:0.22.1 .
GTS_DOCKER_IMAGE=weave-gotosocial:0.22.1 pnpm exec playwright test -c playwright.integrated.config.ts
GTS_DOCKER_IMAGE=weave-gotosocial:0.22.1 GTS_TEST_REGISTRATION=true pnpm exec playwright test -c playwright.integrated.config.ts --grep 'open registration'
```

The harness creates a uniquely named container with anonymous volumes and three local accounts, binds only to loopback, and promotes Alice for admin cases. On normal suite shutdown, it stops/removes its own container and volumes. Test credentials are intentionally fixed and confined to disposable instances. Do not point these suites at production.

## Release binary alternative

Download the correct 0.22.1 archive from the [official release](https://codeberg.org/superseriousbusiness/gotosocial/releases/tag/v0.22.1), verify it against the release's `checksums.txt`, and extract both the binary and web files.

```sh
pnpm build
GTS_WEB=/path/to/release/web node scripts/gts-bundle.mjs
GTS_BINARY=/path/to/release/gotosocial pnpm exec playwright test -c playwright.integrated.config.ts
GTS_BINARY=/path/to/release/gotosocial GTS_WEB=/path/to/release/web pnpm test:e2e
pnpm test:coverage
pnpm exec playwright test
```

Default local paths are `/tmp/weave-gts-0.22.1/gotosocial` and `/tmp/weave-gts-0.22.1/web`. The binary harness creates a fresh SQLite/storage directory under `/tmp/weave-gts-e2e/run-*` for every run and retains it for diagnosis. Set `PLAYWRIGHT_BROWSERS_PATH` consistently when using a non-default browser installation.

External OIDC, outbound email, remote federation delivery, and all advanced administration combinations are not covered. See [remaining limitations](frontend-replacement.md#validation-and-limits).
