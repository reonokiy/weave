# Same-URL frontend replacement

## Target and packaging

Target: official GoToSocial **v0.22.1**, source revision `fdff42baf16bdc8f793ce5137ecf2c2e6c67a9f2`.
The official release is [v0.22.1](https://codeberg.org/superseriousbusiness/gotosocial/releases/tag/v0.22.1).
The image resolved during validation to `sha256:0078ca451dda5e8c4a8630784519f99b69f48c3dda79586a9703d4bf8ea14dae`.

The Dockerfile copies Weave templates and static assets onto the official image. It **does not patch or recompile GoToSocial**, add a runtime proxy, or change the official entrypoint, command, user, or ports.

## Existing installation

Build from the repository root:

```sh
docker build -t weave-gotosocial:0.22.1 .
```

Change only the image of your existing GoToSocial service to `weave-gotosocial:0.22.1`.
[Compose override example](../deploy/compose.override.yaml.example) shows the relevant setting.

Keep the existing host/domain, protocol, database, storage volumes, environment, startup flags, port mapping, and reverse proxy. Requests still reach the original GoToSocial server. Do not route public paths to a static SPA or add `try_files ... /index.html`. Existing WebSocket upgrade handling remains necessary.

A volume mounted over `/gotosocial/web`, `/gotosocial/web/template`, or the entire assets directory can hide the image's new files. Use the generated bundle for those mounts, or remove only the obsolete web-file mounts. Preserve database and storage mounts. If custom web base paths are configured, point them at the generated bundle.

This assumes a backend compatible with 0.22.1. Updating an older backend also requires the official release's database migration procedure; changing frontend files is not a database downgrade or rollback mechanism.

## Keep the official image name

It is also possible to keep `docker.io/superseriousbusiness/gotosocial:0.22.1` as the running image and mount only frontend files:

```sh
docker create --name weave-web-export weave-gotosocial:0.22.1
docker cp weave-web-export:/gotosocial/web ./weave-web
docker rm -v weave-web-export
```

Add these read-only mounts to the existing service:

```yaml
volumes:
  - ./weave-web/template:/gotosocial/web/template:ro
  - ./weave-web/assets/weave:/gotosocial/web/assets/weave:ro
```

The export container never starts. No additional service is needed at runtime. Keep all existing database/storage mounts alongside these two entries. Rollback of the frontend is removal of these two mounts, or restoration of the official image when using the derived image.

## Routing and interface

| Original path | Behavior |
| --- | --- |
| `/`, `/login` | Instance landing page; authenticated timeline where the server supplies the corresponding page |
| `/@username`, original status URLs | Public data rendered from GoToSocial's visibility-filtered template context; authenticated Vue interactions |
| `/tags/name`, `/about`, `/directory` | Public views and authenticated tag timelines |
| `/auth/*`, `/oauth/*`, `/signup`, `/confirm_email` | Vue forms at original actions; GoToSocial owns cookies, authentication, consent, and validation |
| `/authorize_interaction?uri=...` | Keeps the requested URI across OAuth and resolves the account or post through the user's token |
| `/settings/user/*` | Profile, posting preferences, interaction requests, security/2FA, applications/tokens, migration, import/export, relay pushes |
| `/settings/moderation/*`, `/settings/admin/*` | Role-aware administration backed by release-specific request contracts; JSON domain permission import/export |
| API, ActivityPub, WebFinger, media, streaming | Original backend handlers and content negotiation |

The bundle changes `page.tmpl` and `maintenance.tmpl`; it retains upstream supporting templates for the no-JavaScript fallback. Own assets use `/assets/weave/`. Open Graph, robots, RSS, and ActivityPub alternate metadata are retained. English is the default; Vue I18n provides explicit English/Chinese selection.

Settings authorization requests `read write admin`, matching the original settings application. Backend authorization still determines whether a user may perform an admin action. Application-token authorization is isolated from Weave's own OAuth session.

## Source contracts

Inspected release source:

- `internal/web/{web,profile,thread,authorize-interaction,maintenance}.go`: URL ownership, content negotiation, public context, and maintenance response.
- `internal/api/util/{template,errorhandling}.go`: `page.tmpl` hook and native HTML/JSON error handling.
- `internal/api/auth/signin.go`: native password and two-factor sign-in.
- `internal/api/client/user/twofactor.go` and `internal/processing/user/twofactor.go`: QR/URI, enable/disable, and recovery codes.
- `web/source/settings/views/{user,moderation,admin}/router.tsx`: original settings paths.
- `docs/api/swagger.yaml`, corresponding client handlers, and `internal/api/model/account.go`: generated settings contracts, including correction of the documented alias string to the actual string array.

Regenerate the 26 settings groups / 104 catalog operations using Python + PyYAML:

```sh
GTS_SOURCE=/path/to/gotosocial-v0.22.1 python3 scripts/settings-catalog.py
```

Security and application-token flows also have dedicated components. A catalog entry is not proof that every combination of its parameters has been tested.

## Validation and limits

See [integration tests](e2e.md) for setup. Tests use fresh local accounts and disposable data.

Native error negotiation is retained. Browser HTML errors can use the new template; OAuth protocol errors or requests that negotiate JSON may still display the backend's JSON response. No wrapper rewrites them.

External OIDC, real outbound email delivery, live remote federation/relay delivery, and every advanced administration action have not been exercised end to end. The remote emoji path currently shares the emoji resource view. Interaction-request details currently open the request review view. Domain bulk transfer currently accepts GoToSocial JSON, rather than every format accepted by the upstream browser's conversion tools. These are remaining parity/validation limitations, not changes to the backend.
