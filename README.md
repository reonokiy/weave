# Weave

An alternative frontend for [GoToSocial](https://gotosocial.org), built with Vue 3, TypeScript, and UnoCSS.

Replaces public pages, authentication forms, and settings at the existing URLs, and adds a social client with timelines, posting, media, polls, notifications, and search. Supports English and Simplified Chinese. GoToSocial continues to handle authentication, permissions, federation, and storage.

## Development

Requires Node.js 22.12+ and pnpm 11.

```sh
pnpm install
pnpm dev
```

```sh
pnpm test
pnpm build
```

## Deployment

The Docker image bundles Weave with GoToSocial **0.22.1**:

```sh
docker build -t weave-gotosocial:0.22.1 .
```

Use it in your existing GoToSocial service, keeping its configuration and data volumes. Existing mounts over `/gotosocial/web` can hide the bundled frontend; see the [deployment guide](docs/frontend-replacement.md).

For a standalone client under `/weave/`, run `pnpm build --base=/weave/` and serve `dist/` using the [Nginx example](deploy/nginx.conf.example).

[Compatibility](docs/gotosocial-compatibility.md) · [Integration tests](docs/e2e.md)
