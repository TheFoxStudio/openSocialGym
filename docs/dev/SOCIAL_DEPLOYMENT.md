# Deploying and operating openSocialGym

Phase 5 local tooling is implemented. Container execution, HTTPS hosting and real
Android/iOS acceptance are release gates, not completed deployment claims.

## Source-built server

Use a current Docker Compose v2 installation. This fork's `docker-compose.yml`
builds `opensocialgym-api:local` and `opensocialgym-web:local` from the checkout,
with `pull_policy: build`. Upstream registry images do not contain these features.
Both default and optional coach API targets copy the social modules and keep
Sharp's native runtime binaries. Container labels identify this fork.

Copy `.env.example` to `.env`, choose the settings, then run:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

For a private beta, set `SOCIAL_ENABLED=1`, `FIRST_USER_ADMIN=1`, register the owner
before sharing the URL, and then set `INVITE_ONLY=1`. Configure `ADMIN_UIDS` for an
existing account instead of relying on first-user bootstrap. Leave the Coach off
unless you specifically need it. Its opt-in target is selected with `API_TARGET=coach`.

For HTTPS, use your reverse proxy and exact public values, for example:

```dotenv
RP_NAME=openSocialGym
RP_ID=gym.orktork.space
ORIGIN=https://gym.orktork.space
SOCIAL_ENABLED=1
WEB_PORT=8080
```

The deployment hostname is `gym.orktork.space`. Set it before registering
passkeys. Do not expose the API port separately from the web proxy. Retain the
existing proxy upload limit above the private-media upload limit. Social photos
are separately bounded and authenticated; they have no public static directory.
Keep `./data:/data` persistent across rebuilds. A Compose project created by the
upstream checkout may still be running under `opengym`; stop that old stack before
starting this fork's `opensocialgym` project against the same data or host port.

## Offline backup, verification and restore

The host needs Node 22.23.4 or newer with `node:sqlite` for server diagnostics and
tests. The backup CLI itself uses only Node built-ins. Create the backup parent
directory first. Examples below work in a terminal at the repository root:

```sh
docker compose stop api
node scripts/instance-backup.mjs backup data .instance-backups/pre-upgrade --offline
node scripts/instance-backup.mjs verify .instance-backups/pre-upgrade
docker compose start api
```

`--offline` confirms that you stopped **all** API processes and other writers using
this directory, including any locally started Node server. The tool cannot enforce
that an external process stays stopped; it detects file-list, size, timestamp and
checksum changes as an additional check. Do not use it as an online backup API.
The destination must not exist and must be outside the source data directory.

All regular files under `DATA_DIR` are copied, including account/passkey JSON,
session secret, private state, private media, social SQLite and post photos. The
legacy `.backups` subdirectory is excluded to avoid copying old backup archives.
Links and special files are refused. SHA-256 checksums are recorded in a manifest,
and a verified staging directory is renamed into place only after success. Failed
copies stay under a unique `.partial-*` path for inspection; do not treat them as
successful backups. Protect backups as you protect the original account data.
Checksums detect corruption; they do not authenticate a maliciously modified archive.

The `.env`, proxy configuration and signing/provider credentials outside `DATA_DIR`
need separate operator retention. `.instance-backups/` is excluded from Git and
Docker builds. Copy verified backups to your chosen separate storage with retention;
a second directory on the same disk is only an upgrade convenience.

Restore into a **new** directory, never over the live data:

```sh
node scripts/instance-backup.mjs restore .instance-backups/pre-upgrade data-restored
```

The restore verifies every checksum before copying, checks the copied bytes again,
and refuses extra/missing files or an existing destination. Stop the server before
switching its bind mount or `DATA_DIR` to the restored directory. Run the same server
version as the backup first, then verify sign-in, private training, avatars, shared
post images and follows using two accounts. Upgrade only after that check.

Schema 5 adds likes and comments and migrates transactionally on server startup. To roll back to
older code, restore the complete pre-upgrade backup with that code; do not run an
older server on schema 5 or restore only SQLite while leaving mismatched photos.

## Storage monitoring and performance

```sh
node api/scripts/social-status.mjs data
node api/scripts/social-feed-probe.mjs
```

`social-status` opens SQLite read-only and reports schema, quick-check result,
aggregate profile/post/report counts, image bytes, missing image files and free disk
space. It prints no credentials, captions or member names. Exit status 0 means no
detected issue; 2 indicates low disk, failed integrity or missing image files; 1
indicates a diagnostic error. `MIN_FREE_MB` changes the default 1,024 MiB alert
threshold. Schedule this command with your host monitoring and alert on nonzero
status. `DATA_DIR` can supply the mounted path inside a container:

```sh
docker compose exec api node scripts/social-status.mjs /data
```

The API image includes `api/scripts/social-status.mjs` under `/app/scripts`.
Quick-check can briefly contend with active writes, so schedule large databases
during quiet periods. This diagnostic is not a reservation or a disk-full simulator.
Current photo bounds remain 100 MiB per account, ten pending uploads, one photo per
post and pending-upload cleanup after 24 hours. Operators still need instance disk
alerts and a retention/capacity policy; there is no new global storage quota setting.

The performance probe uses a disposable directory with 50 authors, 1,000 posts,
eight exercises and four sets each, ten followed authors and 200 paginated reads.
It asserts followed-author filtering and fails above a default 100 ms p95 budget.
`FEED_MAX_P95_MS` adjusts the budget for a deployment machine. It is a synchronous
store/query probe, not concurrent HTTP load or a guarantee for very large instances.

## Container and phone release gates

The existing `Tests` GitHub workflow's image job builds both API targets and the web
image without publishing. Its added social smoke checks exercise the actual Linux Sharp binary,
profiles, publication, follows, feed, export, admin authorization and persistence
after restart. Run locally when Docker is available:

```sh
docker build --target default -t opensocialgym-api:smoke ./api
node scripts/ci/social-container-smoke.mjs opensocialgym-api:smoke
docker build --target coach -t opensocialgym-api:smoke ./api
node scripts/ci/social-container-smoke.mjs opensocialgym-api:smoke
docker build -f web/Dockerfile -t opensocialgym-web:smoke .
```

Before distributing native binaries, give the fork its own application identity,
signing and links. Current inherited identifiers are Android
`ch.duartesantos.opengym` and iOS `ch.opengym.app`. They are not approved fork release
identifiers. Choose identifiers under your control and update Capacitor, Android
namespace/application ID and Java package paths, iOS bundle IDs/entitlements,
deep links, passkey association files, store metadata and CI signing together.
Existing upstream app data does not automatically migrate to a new app ID.
Retain AGPL notices and upstream attribution when changing branding.

The fork now generates routine/NFC HTTPS links on `gym.orktork.space`, prefills
that server in the connection screen, and declares it in Android link filters and
iOS associated domains. The local development `.env` continues to use localhost;
the deployment template `.env.example` uses the production RP ID and origin.
To enable verified native links, publish `/.well-known/assetlinks.json` with the
final Android package name and release signing SHA-256 certificate fingerprint,
and `/.well-known/apple-app-site-association` with the Apple team ID plus final
iOS bundle ID and the `/r`, `/r/*`, `/nfc` and `/nfc/*` paths. Include the
`webcredentials` association and `webcredentials:gym.orktork.space` entitlement if
the native sign-in flow uses shared web credentials. Serve these files directly
over HTTPS with JSON content types, without redirects or the SPA fallback. No
placeholder signing identity is published by this repository.

Record these acceptance results before inviting a wider beta:

- Two real accounts on the final HTTPS hostname: register/sign in with passkeys,
  pair each phone, follow each other and verify the correct server identity.
- Android and iOS: finish a workout, decline sharing, then publish another workout
  with library photo and with camera capture. Check cancel/denied permissions and
  photo orientation. Verify private notes, body weight and location stay private.
- Queue explicit publishing offline, reconnect, restart the app, and verify no
  duplicate post. Switch accounts/server and verify drafts remain isolated.
- Unfollow, block, change audience, delete a post, remove a profile and perform an
  administrator takedown. Verify previous image URLs stop returning content.
- Restore a real instance backup into a separate deployment and verify account,
  private workout, avatar, feed and media integrity with both accounts.
- Verify proxy HTTPS/upload limits, storage alerts, disk-full behavior, restart
  recovery and container smoke results on the target architecture.

Local Windows verification on 2026-11-06: offline backup/restore tests passed with
private data and social images; corruption and overwrite rejection passed. The
1,000-post probe returned 6.35 ms p95 for 200 reads with the container's Node 22.23.4
runtime on this machine. Storage diagnostics
reported schema 4, a successful quick-check and no missing photos. Docker is not
installed here, so container smoke is prepared but has not been executed locally.
No hosting endpoint, native signing setup or physical phone was used in this phase.
