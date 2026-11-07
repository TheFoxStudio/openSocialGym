# Social profiles: first implementation milestone

Implemented in this fork: opt-in profiles, unique handles, display names, bios,
member profile pages, avatars, profile editing, and removal. Member search, following
and blocking are now implemented too; see [Friends and blocking](SOCIAL_FRIENDS.md).
Workout publication is implemented in [Phase 3](SOCIAL_POSTS.md); the Following
timeline, reporting and export are implemented in [Phase 4](SOCIAL_TIMELINE.md).

## Enable and try it

1. Set `SOCIAL_ENABLED=1` in the instance's `.env` file. It defaults to off.
2. Build this fork's containers with `docker compose up -d --build`. Pulling the
   upstream images does not install these changes. The API needs Node 22.23.4
   (the pinned container runtime) or a compatible newer Node version.
3. Sign in using the existing account flow and select **Social profile** on Home.
4. Choose a handle, display name and optional bio, read the member-visibility
   disclosure, and confirm it to create the profile. No existing user is opted in
   automatically, and no private training document is published.
5. Select **Edit profile**, choose a photo or take one, check the preview and save.
   The image is centered and cropped to a square on the server. Removing a profile
   keeps the authentication account and private training history.

Another signed-in member can open `/#/social/profiles/<account-id>` to view a
profile, or use **Find friends** to search and follow members. A local-only phone,
guest account, old server or disabled server receives the connection/settings
explanation. Pairing remains the existing **Server & sync** flow.

## Architecture decisions

- Existing authentication account IDs identify profiles; the social handle is
  separate from the login name. Handles are lowercase ASCII letters/digits/
  underscores, 3–30 characters, unique case-insensitively. System names are reserved.
- `DATA_DIR/social/social.sqlite` now stores schema version 4 (profiles, graph, posts and reports). The implementation uses
  built-in `node:sqlite`, verified against Node 22.23.4 and the local Node 24.22.1.
  Node 22 marks this API experimental. Pin the runtime, run the compatibility
  tests on upgrades, and fail on an unknown future schema instead of downgrading.
- For this single-process deployment, synchronous short SQLite transactions use
  a rollback journal and a five-second busy timeout. Do not run multiple API
  replicas against a shared network drive. Profile edits require a matching
  revision to avoid silently overwriting another device's changes.
- Avatars are a deliberate refinement to the original file-storage proposal:
  each profile holds at most one processed image, at most 256 KiB, as a SQLite BLOB.
  Replacement, reference invalidation and deletion are therefore transactional,
  and backups include avatar bytes. Future workout-post media should use a
  separate asset store rather than placing large photos/videos in this table.
- Sharp 0.35.5 handles authoritative decoding, orientation correction, centered
  512×512 crop, WebP encoding and metadata removal. Server input is restricted to
  JPEG/PNG/WebP stills, 2 MiB and 4 million pixels. The browser reuses the existing
  guarded ingest pipeline first, supporting larger source photos by resizing them
  before upload. Unreadable source formats produce an actionable picker error.
- Decoder concurrency is one, input uploads at most two, processing timeout five
  seconds, upload lifetime fifteen seconds, image cache eight MiB. Writes are
  limited to 30 per account per minute and avatar attempts to six per minute.
  These are initial fixed limits, not configurable media quotas yet.
- Profiles/avatars are visible to authenticated members only. Session and account
  checks apply to direct image requests, with private/no-store caching. Profile
  JSON uses an explicit projection and contains no login secrets or training data.
  Disabled accounts are hidden but preserved. Replaced or removed avatar IDs stop
  resolving. These routes do not change private `/api/media` behavior.
- Removing the authentication account saves the account JSON first, then removes
  the social profile. Missing accounts are inaccessible immediately; startup
  reconciliation removes their orphaned social rows after a crash. Reconciliation
  also runs with the feature off when a social database already exists.
- Frontend state belongs to the mounted `(server, account, viewed profile)` screen,
  never `S` or training sync. Identity changes unmount the screen and late responses
  are ignored; avatar object URLs are revoked. No global social cache persists.
- A profile save and avatar upload are separate requests. If the upload fails,
  the saved profile revision and selected photo remain available for retry.
- Social capabilities are advertised only when enabled, keeping feature-off
  `/api/config` responses compatible with existing clients and tests.

Sharp's [output documentation](https://sharp.pixelplumbing.com/api-output/)
describes its default metadata removal and processing timeout. The
[constructor documentation](https://sharp.pixelplumbing.com/api-constructor/)
describes decoded-pixel limits. The source and tests exercise these controls;
declared MIME types alone are not trusted.

## Verification

Run from the repository root:

```text
node --test api/test/social.test.js api/test/server-social.test.js api/test/openapi-routes.test.js
node api/scripts/social-storage-spike.mjs
node frontend/scripts/check-locales.mjs
node scripts/build-api-docs.mjs --check
```

From `frontend/`:

```text
npm test -- src/views/Profile.test.jsx src/lib/pt-br-locale.test.js
npm run build
```

The storage spike uses an isolated temporary directory: 1,000 profiles, a
1600×1600 avatar input, a consistent SQLite snapshot, restored row count, timings
and peak process memory. Its Windows results do not establish an Alpine container
memory budget. Before deployment, repeat in the image with the intended memory
limit and run both default/coach container smoke checks. The Dockerfile now keeps
Sharp's optional native binaries and removes only the optional AI SDK from the
default base installation; the coach target reinstalls the SDK from the lockfile.

Browser checks on this workstation used the actual API and installed Edge at a
390px mobile viewport and desktop viewport: create, edit, client photo ingest,
upload, reload, second-account read-only view, and absence of horizontal overflow
or page errors. Camera capture was not validated on an actual Android/iOS device.
Browser file inputs use the existing camera/library pattern; real device capture,
permission denial, HEIC handling and pairing still need release-device acceptance.

Baseline before these changes: API 769/800 passing, frontend 7,811/7,832 passing.
Existing failures include Unix-only shell/socket/permission assumptions, generated
file comparisons affected by CRLF, and missing native asset fixtures. Preserve
these separately from new social regressions. The touched OpenAPI file uses LF,
which also resolves its existing exact-newline lookup failure on Windows.

After implementation, the complete API suite passes 776/806 tests (30 remaining
failures all present in the baseline); the complete frontend suite passes
7,816/7,837 tests (the same 21 baseline failures). All six new API tests and five
new profile component tests pass. The focused profile, locale, workout completion
and tab-bar checks pass 38/38; the frontend production build and generated API
reference checks pass. No application feature was deployed to a live instance.

The Node 22.23.4 Windows storage spike measured 1,000 profile writes in 5,771 ms,
an avatar conversion in 13 ms, a 118,784-byte snapshot in 9 ms, and 70 MiB peak RSS.
The image was a uniform-color test input, not a worst-case decoder load; repeat
with representative images inside the deployment container before setting limits.

## Backup, disable and rollback

For a complete backup, stop the instance and copy the entire `data/` directory
as one set, including account JSON, private training, existing private uploads,
the social database and any SQLite journal. Do not copy just the live SQLite file.
The store's `backup(destination)` uses `VACUUM INTO` for a consistent social-only
snapshot, exercised by tests; it is not a coordinated backup of account JSON and
training state. Protect backups as private account data.

Set `SOCIAL_ENABLED=0` and restart to disable profile routes and capabilities while
preserving data for a later re-enable. Use a pre-upgrade full backup when rolling
back to an older release; do not edit `user_version` to force a schema downgrade.
Account deletion continues cleaning social data even while social features are off.

Following and blocking are implemented in Phase 2. Reporting and post visibility
remain future milestones. Do not treat this as a complete social beta.
