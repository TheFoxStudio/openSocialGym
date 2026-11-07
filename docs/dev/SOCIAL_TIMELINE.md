# Following timeline, moderation and social export

Phase 4 is implemented locally. With `SOCIAL_ENABLED=1`, the server advertises
`social.feed`, `social.moderation` and `social.export`. Open **Following timeline**
from Social profile, or scroll the embedded feed directly on Home below its compact
weekly statistics. Home loads further pages near the end of the list and retains
the manual Load more control. Stats opens detailed statistics; its Training overview
button opens the former Home dashboard. Social still requires an account on this server.

## Timeline

The feed includes your own published workouts and visible posts by accounts you
currently follow. A members-audience post from an unfollowed account remains
accessible on its profile, but does not enter Following. Blocks, opt-out, disabled
accounts, audience edits and deletions apply to each page, image and revalidation.
The API never reads private training documents to build a feed.

Pages sort by creation time descending, then ID descending. Opaque encrypted
cursors bind the account and list, expire after one hour, and retain a publication
sequence ceiling. New inserts cannot appear halfway through an older pagination
session, even if timestamps tie or move backwards. Refresh starts a new session.
Queries use the author/date index, consider only self/followed authors, and scan at
most 200 candidates per page; a filtered empty page may still have a next cursor.
The API accepts 1–50 posts per page; the app requests ten and retains at most fifty.

Cards show the current public author, caption, audience, a compact workout preview
and an optional photo. Opening a card shows the complete published snapshot.
Images load near the viewport, use authenticated no-store responses and release
object URLs when removed or scrolled away. Feed text and images are not persisted
for offline reading. Going offline clears cards; reconnect, focus, visibility and
local/cross-tab social changes refresh. A visible timeline rechecks every 30 seconds.
After loading several pages, periodic checks preserve the reading position while
removing or updating restricted content. Refresh returns to newer posts.

## Reports and administrator removal

Other members' profiles and opened workout posts have **Report content**. The
form sends only on explicit submission, with spam, harassment, privacy or other
reason and at most 1,000 characters. Report attempts are limited to ten per account
per hour in addition to the shared write budget. Stable request IDs make response
loss safe; duplicate reports for one target lifetime reuse the original report.

Administrators open **Admin → Social reports**. The server independently checks
the administrator role on queue, detail, image and resolution requests. Review
access exposes only the reported social target and image; it grants no access to
private workout history. Reports can be dismissed or content removed after a
second explicit confirmation. Removing a profile cascades its posts, photos and
follows. Private workouts, blocks and account login remain. Existing Admin account
restrictions handle repeat abuse. Closed reports are idempotent, and reports from
an earlier profile lifetime cannot remove a newly recreated profile.

Reports remain for review after social opt-out. Account deletion removes reports
submitted by or targeting that account. Submitted reports are included in the
reporter's export; incoming reports and reporter identities are never exported to
the target account. Audit events contain action IDs, without captions/report text.

## Export

**Social profile → Export social data** downloads a store-only ZIP on web or opens
the native share flow. `social.json` contains your profile, shared snapshots,
following/followers/blocks, submitted reports and drafts saved on this device for
this account/server. It excludes publish request credentials, incoming reports and
private training history. Referenced photos and avatar are separate WebP entries.
Post photo requests pin the expected asset ID so a concurrent replacement cannot
silently export different image bytes. Files deleted during export are listed in
`missingFiles`. Export stops if the active account/server changes.

Exports paginate current state; they are not atomic disaster-recovery backups.
Bounds are 25 MiB of metadata, 150 MiB total ZIP payload and 1,998 image entries.
Large communities/accounts should use an operator backup. Rate-limited export
reads retry at most three times, respecting delays up to 60 seconds each.

## Migration and operations

Startup upgrades SQLite schema 3 to 4 transactionally: existing posts receive
publication sequence numbers; a durable sequence counter, random cursor key and
reports table are added. No training JSON is changed. Stop the server and back up
the entire `DATA_DIR` before upgrading, including the social database and photos.
Restore that complete offline backup when rolling back server code; an older
server refuses schema 4. Do not copy an actively written database as a backup.

Tests cover tied-timestamp pagination with concurrent inserts, cursor tampering,
identity/context changes, current follows/blocks, report retry and epoch protection,
photo takedown, owner export, HTTP admin authorization, ZIP contents, offline feed
purging, and schema-3 upgrade plus offline restore. Native capture, deployment
containers, disk-full acceptance and two real paired phones remain Phase 5 release
checks. This phase does not claim a production deployment or native-device test.

Local verification on 2026-11-06: 39 focused API checks and 46 focused frontend
checks passed, as did API/spec parity, generated docs, all 19 locale packs, and web
and mobile web builds. The full API run passed 804/834 tests with the same 30
pre-existing platform/fixture failures. The full frontend run passed 7,836/7,857
with its 21 known baseline failures. A later isolated migration/restore test also
passed. Browser checks in Edge at 390 px covered timeline photos, pagination,
offline clearing/reconnect, report submission, ZIP export and administrator removal.
