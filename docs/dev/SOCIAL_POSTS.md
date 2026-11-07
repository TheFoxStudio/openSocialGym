# Workout publication (Phase 3)

Implemented locally: optional sharing after workout completion and from history,
explicit workout previews, captions, audience selection, one optional photo,
durable drafts, confirmed publication retries, profile post lists, and post
editing/deletion. The combined Following timeline, reporting and export are now
implemented in [Phase 4](SOCIAL_TIMELINE.md).

The local instance at [localhost:8080](http://localhost:8080/) advertises
`social.posts: true`. The ignored project `.env` still enables `SOCIAL_ENABLED=1`.
Refresh an already-open app to fetch the new capabilities. No public deployment
or remote Git push was performed.

## Try the feature

1. Sign in and create an opted-in social profile, if needed.
2. Finish and save a workout, then select **Share to feed** on its saved summary.
   History → workout → **Workout options → Share to feed** opens the same composer.
   Saving/finishing a workout never waits for a publishing request.
3. Review the exercise/set preview, add an optional caption, and choose
   **Followers** (default) or **Server members**. Server members means authenticated
   members of this instance; posts never become unauthenticated public links.
4. Optionally choose a photo or take one using the separate camera input. The
   preview shows the selected image with its aspect ratio preserved. Private
   workout photos/form videos are never attached automatically.
5. **Save draft** keeps it on this device. **Publish post** explicitly confirms a
   durable publish intent before any photo upload or POST is sent.
6. Your profile's **Workout posts** button shows published posts and your device's
   saved drafts. Open another member's profile to see their posts that are visible
   to you. The Following timeline is not part of this phase.

An existing post opens for review. **Edit post** changes its caption, audience or
photo. Its snapshot stays unchanged until **Refresh workout preview** is explicitly
chosen. Corrections to private training history do not silently republish data.

Deleting a post keeps private training. Deleting a private workout on a compatible
server offers **Delete workout only** (published post kept) or **Delete workout
and post**. The latter removes the shared post before deleting the private record;
a server error leaves the private workout intact. Unsent local drafts are removed
when that workout is deleted, and retry code rechecks that a source still exists.

## Preview and privacy contract

`frontend/src/lib/social-snapshot.js` builds an allowlisted snapshot, validated
again by the runtime-independent `api/social/snapshot.js` on the server:

- Version 1: title, date, optional duration and named exercises with completed
  work sets. Warmups and unchecked sets are excluded. Completed sides are handled
  individually; holds, cardio, drops and rest-pause totals retain their semantics.
- Weight numbers carry explicit kg/lb units, including per-exercise unit pins.
  Cardio speeds are explicitly km/h. Custom exercise names are captured so viewers
  do not need access to private exercise definitions. Snapshots include total volume, record counts and catalog exercise identifiers
  when available.
- Private session/exercise/set notes, body weight, raw health/heart-rate readings,
  gym/location, routine internals, original image metadata and private attachments
  are excluded. Average heart rate is shared only through an explicit composer
  checkbox and appears in the publication preview. Unknown JSON fields are discarded by the server allowlist.
- Strings, numeric ranges, dates, exercise/set counts and intensifier arrays are
  bounded. The server accepts the author's explicit client-provided snapshot;
  it does not inspect another user's private training document or certify that
  the described workout happened. Private sync need not finish before publication.
- Source workout references are author-scoped and returned only to the author.
  In particular, legacy references containing timestamps are not exposed to others.
- Post and image reads use the same current-account, audience, follow and two-way
  block policy. Unfollow/block/audience changes affect subsequent requests, direct
  guessed URLs included. Restricted images use authenticated, private/no-store
  delivery. Previously viewed or downloaded content cannot be recalled.

## Drafts, retries and concurrency

Drafts live in IndexedDB (`opensocialgym-social-drafts`), partitioned by normalized
server/account scope and source workout identity. They contain only the intended
public preview, caption/audience, processed selected photo Blob and request metadata,
never credentials or the complete private training state. Draft writes are ordered;
photos are not converted to base64 in the training JSON or browser localStorage.

- An ordinary draft never publishes on reconnect. Only a previously confirmed
  pending/failed intent can retry, using its stable request ID and payload.
- A confirmed offline intent retries when the composer reconnects or is reopened
  online. This is a screen-scoped outbox, not a phone background-upload service;
  closed drafts remain available from **Workout posts** until reopened.
- **Cancel publishing** changes the local intent back to a draft. A request already
  accepted by the server may have published; review/delete that post separately.
- Signing out, switching servers/accounts, leaving the composer during photo
  upload, or deleting the source prevents subsequent sending steps. Late responses
  do not update the next identity's UI. The server still enforces session validity.
- Permission, validation and revision errors stop automatic retry and require
  review. Connection failures retain the confirmed intent. Storage failure prevents
  sending a new publish intent; the workout remains saved privately.
- There is one active post per author/source workout. Replayed identical create
  or edit requests return the existing result. Changed bodies with the same key,
  concurrent edits with an old revision and competing device publications return
  conflicts instead of silently duplicating/overwriting posts.
- Deleted request keys retain tombstones. A delayed retry cannot resurrect a
  deleted post; republishing requires a new explicit request.
- Each social-profile lifetime has a random `socialEpoch`. Profile removal clears
  posts/assets and local drafts, and old queued epochs remain invalid after profile
  recreation, including queues held on another device. A restored draft requires
  explicit review under the new profile before it can publish.

## Storage, limits and migration

Schema v3 adds posts, asset metadata, durable publish-request records and profile
lifetimes. Existing v1/v2 profiles, avatars, follows and blocks are preserved by
versioned transactions. Avatars remain bounded SQLite BLOBs; workout photos live
separately in `DATA_DIR/social/post-photos/<uuid>.webp`, outside nginx's public root.

Uploads accept client-processed JPEG/PNG/WebP stills up to 2 MiB and four million
decoded pixels. Sharp decodes, orients, strips metadata and re-encodes WebP with a
maximum 1920px long edge, preserving aspect ratio. Output is capped at 1 MiB.
Photos are optional and limited to one per post; videos/GIFs are excluded.

The server enforces 100 MiB of post-photo storage per account and at most ten
unlinked uploads. Social writes/reads keep the existing 30/120-per-minute limits;
avatar and post-photo uploads share six attempts per minute, two in-flight uploads
and one active decoder. Upload lifetime is 15 seconds; processing has a five-second
Sharp timeout and a four-million-pixel guard. A free-disk floor protects writes.
These initial limits are fixed in code and advertised/documented separately from
the existing private-media subsystem.

Bytes are atomically written/fsynced before asset metadata is acknowledged.
Unlinked uploads expire after 24 hours; cleanup runs on startup, uploads and
deletion. Referenced photos are retained. Replacing/removing a post photo removes
its unreferenced file immediately; orphan files after a crash are swept on restart.
There is no unauthenticated or cross-account endpoint for pending uploads.

The web Docker build now copies the two runtime-independent shared schema files.
CI dependency installs preserve Sharp's optional platform binaries and remove only
the optional AI SDK, instead of omitting all optional dependencies. The Nix API
package includes the social and integration module directories. Linux containers
and Nix builds still require validation on hosts with those tools.

## Validation and release limits

Run from the repo root:

```text
node --test api/test/social-posts.test.js api/test/social.test.js api/test/social-graph.test.js api/test/server-social.test.js api/test/openapi-routes.test.js api/test/server-config-session.test.js
node frontend/scripts/check-locales.mjs
node scripts/build-api-docs.mjs --check
```

From `frontend/`, run the new snapshot/outbox tests, profile/member tests, saved
summary/history tests, locales and existing workout completion/tab-bar checks.
The focused run passes 82 tests. The API social/contract/config checks pass on the
exact Node 22.23.4 container runtime; full API regression is 793/823 passing with
the same 30 pre-existing platform/fixture failures. Production web and mobile web
bundles build. All new UI strings are present in all 19 translation packs.

The full frontend run found the same 21 baseline failures plus an old assertion
expecting only the previous Share button order. That assertion was updated for
the added social action and passes, with an additional check that the workout is
saved before navigating to sharing. No green full-suite claim is made.

The three-account Edge flow verified preview privacy, IndexedDB caption/photo
restore after reload, an explicit offline queue, online retry, non-publication of
unconfirmed drafts, follower-only photos, member audience, independent snapshots,
caption/photo editing, post deletion preserving private training, and the combined
workout/post deletion choice. Mobile-width layout and images were visually checked.

Native camera permissions/capture, native builds, container memory limits and Nix
remain release-host/device acceptance checks. Camera/library inputs follow the
existing app pattern; this workstation has no connected test phones or Docker.
The package-install/prune sequence was separately checked on Windows: Sharp loads,
the optional AI SDK is absent, and package manifests/lockfiles remain unchanged.

## Backup and rollback

Before the local upgrade, the API was stopped and its data copied to
`data/.backups/before-posts-20261106-142013/`. The API was then restarted and its
live config checked for enabled post sharing.

Back up the complete stopped instance's `data/` as a coordinated set. A SQLite
`VACUUM INTO` snapshot includes avatars and post metadata but does **not** include
the separate post-photo files, account JSON, or private training/uploads. A full
restore needs all of them. Do not downgrade a schema-v3 database in place; restore
the coordinated pre-upgrade backup with the older release. Disabling social
features preserves data and continues account-deletion cleanup.


## Compact completion and composer

The completion modal places smaller duration, volume, sets and PR totals beside
the trained-muscles graphic. Share to feed is primary; Save returns home with the
already saved private workout. The separate image Share and private photo/video
controls are removed from this modal.

The sharing form displays exercise count, volume and PR count above the caption,
without expanding individual exercises and sets. The full workout snapshot is
still published and shown on the resulting post. Followers and Public are adjacent
selectable buttons; Public retains the existing members audience and requires a
signed-in server account. Add photo opens a native modal dialog with Choose photo
and Take photo actions. Escape or Cancel dismisses it.

There is no manual Save draft button. Automatic local draft persistence remains.
Cancel and save private resets pending publication intent, persists an unconfirmed
local draft, and returns home without publishing. The private workout was saved
before entering the composer. Cancelling an edit preserves the existing post.

Verification: eight focused completion/draft tests and the web build passed.
Isolated Edge checks covered the side-by-side summary, audience buttons, photo
popup and Escape, cancellation without a publish request, and 320 px width.
