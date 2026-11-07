# Following timeline, moderation and social export

Home contains only the timeline, with friends, profile and settings icons in the
header. Statistics remain on Stats. Social requires a server account and
SOCIAL_ENABLED=1; social.interactions advertises likes and comments.

## Timeline

The feed includes your own published workouts and visible posts by accounts you
currently follow. A members-audience post from an unfollowed account remains
accessible on its profile, but does not enter Following. Blocks, opt-out, disabled
accounts, audience edits and deletions apply to each page, image and revalidation.
The API never reads private training documents to build a feed.

Pages sort by workout date descending, then publication time and ID descending. Opaque encrypted
cursors bind the account and list, expire after one hour, and retain a publication
sequence ceiling. New inserts cannot appear halfway through an older pagination
session, even if timestamps tie or move backwards. Refresh starts a new session.
Queries use the author/workout-date index, consider only self/followed authors, and scan at
most 200 candidates per page; a filtered empty page may still have a next cursor.
The API accepts 1–50 posts per page; the app requests ten and retains at most fifty.

Cards show avatar, display name and posting date, workout title, optional caption,
and label/value metrics for duration, volume, optional records and opt-in average
heart rate. Five exercise rows show icons, set counts and names; a link opens the
remaining exercises. Photos open first in a square carousel: swipe left or use
the pager buttons to see the workout list.

Likes animate briefly, respecting reduced motion. Comments appear below the post
and support pagination, owner deletion and reporting. Comment authors and post
owners can delete comments. Deleted text is erased; retained IDs prevent delayed
retries from resurrecting comments. Interactions enforce current post access and
blocks, and use stable comment IDs for retries.

Images load near the viewport with authenticated no-store responses. Feed text
and images are not persisted offline. Going offline clears cards. Pull down at
the top to refresh with a fading loading indicator; keyboard users can focus
Refresh feed. There is no polling timer or automatic reconnect reload. Focus,
visibility and social changes revalidate existing posts without fetching a new
timeline. More pages load as you scroll, with a Load more fallback.

## Hevy imports

Prepare social drafts optionally saves unpublished local drafts from imported
workouts and descriptions. Existing drafts are preserved. Review drafts through
your profile's Workout posts before publishing. Hevy's public API and CSV exports
do not provide social photos, likes, comments or post visibility, so this cannot
reproduce your original Hevy timeline. Add photos manually. Drafts never publish
automatically. API reference: https://api.hevyapp.com/docs/

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
following/followers/blocks, your likes and comments, submitted reports and drafts saved on this device for
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

Schema 5 adds likes and comments transactionally without rewriting existing posts
or follows. Previously, schema 3 to 4 added the following: existing posts receive
publication sequence numbers; a durable sequence counter, random cursor key and
reports table are added. No training JSON is changed. Stop the server and back up
the entire `DATA_DIR` before upgrading, including the social database and photos.
Restore that complete offline backup when rolling back server code; an older
server refuses schema 5. Do not copy an actively written database as a backup.

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


Feed and interactions verification, 2026-11-06: 15 focused API tests and 41 focused
frontend tests passed. Web and mobile web bundles built successfully. An isolated
Edge browser check with mocked HTTP responses covered the square photo, native
touch swipe to exercises, like/comment controls and 320 px layout. Backend HTTP
tests independently cover real authorization and mutation behavior. Pull-to-refresh
and the absence of polling are covered in the focused Feed tests. The full app
suites were intentionally not rerun for this change. No native device or production
deployment is claimed. Back up DATA_DIR before deploying schema 5.

## Compact social profiles

Profiles center the avatar and public profile information above total workouts,
total volume, followers and following. Workout totals include only published
snapshots visible to the viewer, never private training history. Volumes normalize
to kilograms on the server and display in the viewer's preferred unit. The newest
four visible photo posts appear in a square thumbnail strip linking to the posts;
older photo posts are included even when the latest workouts have no photo.
The account's regular post timeline follows, with scrolling pagination and saved
drafts shown only to their owner. No database migration is needed for this layout.

Following opens the account list. Your own list includes Find friends and Blocked
members. Edit profile, Export social data and Remove social profile are inside
the three-dot menu; removal still requires confirmation. Following timeline is
removed from the profile because Home already supplies it.

Focused profile verification: 13 API checks (including overview visibility, unit
conversion and photo limit), 12 frontend checks, a web build, and an isolated Edge
check of centering, photos, menu editing and Following navigation passed.


## Optional Home information

Settings > Look & Home > On Home controls the information above the feed: body
weight, recovery tips, week/month recap, weekly sets and monthly challenges.
These and Show connection status default to off. Explicit existing choices remain
unchanged. Home renders only enabled cards, respecting their module switches and
existing timing/data requirements (for example, recap cards only when one is due).
The connection banner keeps its existing global position when enabled.

The body-weight card is shared with Training overview so logging, goal and history
controls behave consistently. Changing a Home toggle updates the cards without
remounting or reloading the social feed. Pull-to-refresh also works when a gesture
starts on the optional information above the feed.

Verification: 48 focused frontend checks, a web build, and an isolated Edge check
of fresh defaults, real cards above the feed, live toggles without a feed reload,
and 320 px layout passed. The full app suites were not rerun.
