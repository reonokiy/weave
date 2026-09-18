# GoToSocial compatibility

The integrated frontend targets **v0.22.1**, source revision `fdff42baf16bdc8f793ce5137ecf2c2e6c67a9f2`. Settings contracts were generated against that release. See [release-specific routes and source contracts](frontend-replacement.md#source-contracts).

The client API investigation below used snapshot `61bda3078715289d8155f99455b645a865a4efa6` on 2026-09-12. Snapshot findings do not establish support in other releases. GoToSocial's backend is unchanged.

## Authentication and replies

Source paths in this section refer to the client snapshot above.

- OAuth uses dynamic application registration and authorization code exchange. `internal/api/model/oauth.go` and `internal/api/auth/{authorize,token}.go` did not carry the PKCE fields through the HTTP flow; Weave does not claim PKCE support. It validates state, callback origin/path, and expiry, and stores credentials in tab-local session storage.
- `internal/api/client/statuses/{statusget,statuscontext,statuscreate}.go`, `internal/processing/status/{context,create}.go`, and `internal/api/model/status.go` define thread reads and replies. Server policy markers determine availability. Submitted replies may require approval; submission does not establish delivery or visibility.
- `internal/typeutils/internaltofrontend.go` supplies requester-specific `me` policy markers. Reply visibility is constrained to the original post, and local-only replies inherit the original restriction.
- Source inspection found no status deduplication implementation for `Idempotency-Key`. Concurrent submission is blocked, but retries cannot guarantee duplicate prevention.

## Client API contracts

All source paths below refer to revision `61bda3078715289d8155f99455b645a865a4efa6` in the local reference checkout. These contracts were checked through routes, processing code, and API models.

| Feature | Source | Important behavior |
| --- | --- | --- |
| Favourite/boost/bookmark | `internal/api/client/statuses/{statusfave,statusboost,statusbookmark}.go` and their undo handlers; `internal/processing/status/boost.go` | Favourite writes use `write:favourites`; boosts use `write:statuses`. Boost creation returns a wrapper. Server `me` policy markers decide availability; approval is not immediate publication. |
| Notifications | `internal/api/client/notifications/notificationsget.go`; `internal/gtsmodel/notification.go` | Includes pending.favourite/reply/reblog, update, admin events, and an unknown-type fallback. No read-marker synchronization claim. |
| Search | `internal/api/client/search/searchget.go`; `internal/processing/search/get.go` | v2 search with explicit remote resolution. Nonzero offset returns empty in the source, so the UI does not invent search pagination. |
| Relationships | `internal/api/client/accounts/{relationships,follow,unfollow,mute,unmute,statuses}.go` and block/unblock handlers | Uses server follow/request state and Link pagination; IDs remain strings. |
| Request review | `internal/api/client/followrequests/*`; `internal/api/client/interactionrequests/*`; `internal/api/model/interaction.go` | Follow review uses account IDs; interaction review uses request IDs. Remove only after successful server response. |
| Media | `internal/api/client/media/{mediacreate,mediaget,mediaupdate}.go` | The inspected source returns synchronous 200 for both v1/v2 uploads. Uses multipart v1 without manually setting a boundary. A missing media URL blocks publishing; uploads are never automatically replayed. |
| Edit/delete | `internal/api/client/statuses/{statussource,statusedit,statusdelete}.go`; `internal/api/model/status.go` | Fetch source text and content type; omit immutable fields on PUT; include retained media and media_attributes. Confirm deletion in the UI. |
| Poll create/edit/vote | `internal/api/client/polls/*`; `internal/processing/status/edit.go:processPollEdit`; `internal/api/model/poll.go` | Numeric choice indexes. Omitting poll on edit deletes it. Unchanged options/multiple with expires_in=0 preserve expiry. Changing voting settings resets votes. The API does not expose original hide-count configuration after expiry, so edit settings require review. |
| Policy presets | `internal/gtsmodel/interactionpolicy.go:FeasibleForVisibility`; `internal/typeutils/frontendtointernal.go` | Use feasible audiences per visibility, never send read-only me markers. The server inserts author/mentioned reply permissions. Presets are not arbitrary per-actor policy editing. |
| Default policies | `internal/api/client/interactionpolicies/*`; `internal/processing/account/interactionpolicies.go` | Omitted visibilities reset despite PATCH. Read all current policies immediately before writing and preserve the other effective policies. GET hides inheritance state; retained effective policies become explicit snapshots. |
| Preferences | `internal/api/client/accounts/accountupdate.go`; `internal/api/model/{account,source}.go` | JSON PATCH selected display-name/bio/locked/source preferences. Uses source.note rather than rendered HTML. |
| Filters | `internal/api/client/filters/v2/*`; `internal/api/model/filterv2.go` | Keyword creation, listing, action changes, and removal. hide removes cards; warn collapses content; blur hides only media. Filter results remain tied to the originating view even after interaction updates. Refresh other views after filter changes. |
| Emoji | `internal/api/client/customemojis/customemojisget.go`; status/emoji models | Picker and safe body rendering from shortcode/static URLs. Code blocks and link attributes remain untouched. |
| Streaming | `internal/api/client/streaming/stream.go`; `internal/processing/stream/authorize.go`; `internal/stream/stream.go` | The processor requires broad read, unlike the route's read:streaming annotation. Token subprotocol, same-origin ws/wss, user stream plus local stream when relevant. New activity prompts refresh; delete removes cards; teardown cancels reconnects. |

Old sessions are gated by their known scopes until explicitly reauthorized. New sessions record the token response's scope when provided. Requests are never automatically retried. Source searches found Idempotency-Key only in CORS and an unused scheduled-status field, not a status deduplication implementation.

Preference audience labels follow `internal/api/model/interactionpolicy.go`: public means everyone who can see the post, following/followers are relative to the author, and me represents the requesting user. Known audience values are localized for display, unknown actor values remain intact, and the reserved mutuals value is not offered as a writable preset.

## Contracts confirmed by local instance tests

- `internal/db/bundb/search.go:SearchForStatuses` restricts text search to the requesting author's posts and replies to that author. A locally known status URL is a separate lookup path. The interface explains this limitation in both locales.
- `internal/processing/status/delete.go` enqueues deletion side effects. Conversation results may retain deleted IDs as tombstones. `internal/typeutils/internaltofrontend.go:toDeletedStatusPlaceholder` emits placeholder content and zero-value interaction rules; the outer `statusToAPIStatus` subsequently restores the author. Thus the actual API tombstone can have an author while its policy arrays are null. Weave renders these as unavailable, without interaction controls, and also tolerates a missing author. It does not infer deletion from user-controlled text alone.

Tests exercise source-backed API fixtures, real component state, and an isolated live instance; see [the validation matrix](e2e.md). Other server versions, remote approvals, private recipient delivery and production proxy WebSocket upgrades remain unverified. See the deployment guide for integrated settings coverage and remaining limitations.

## Warm timeline cache recovery

The local instance at revision `61bda3078715289d8155f99455b645a865a4efa6` reproduced a stale public timeline: a new post was readable by ID and announced by streaming, but an unbounded timeline read omitted it after the cache had been populated. A bounded `since_id` query retrieved the missing arrival. Relevant source is `internal/cache/timeline/status.go` (`Load` and `InsertOne`), `internal/surfacing/surfacetimeline.go`, and `internal/paging/{parse,page}.go`. The exact upstream insertion failure has not been established.

Weave supplements each nonempty timeline page with a descending query above its first item, preserving any upper cursor. A full supplementary page keeps the server's next link; a partial one merges by ID with the original page. Generic pagination still owns origin/path validation. This costs an additional request per nonempty page. Empty pages have no anchor for this recovery. Unit regression covers 45 arrivals and multiple cursors; live regression creates 25 new posts after warming the cache and checks complete, unique traversal.
