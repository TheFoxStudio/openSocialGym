# Friends and blocking (Phase 2)

Implemented: member discovery, following/unfollowing, follower/following counts
and lists, blocking, and the own blocked-member management screen. Explicit workout
publication is implemented in [Phase 3](SOCIAL_POSTS.md); the Following timeline is
implemented in [Phase 4](SOCIAL_TIMELINE.md). Following a member never automatically publishes workouts.

## Local instance

The project-local `.env` enables `SOCIAL_ENABLED=1`. It is ignored by Git and
does not change `.env.example`'s opt-in default for other installations.

On this workstation the Node API runs on port 3000 and the Vite development app
on [localhost:8080](http://localhost:8080/), with persistent data in the ignored
project `data/` directory. These are local development processes, not a public
deployment. Docker is not installed here. To restart manually from the repo root:

```powershell
$env:DATA_DIR = Join-Path (Get-Location) 'data'
node --env-file=.env api/server.js
```

In another terminal, from `frontend/`, run:

```text
npm run dev -- --host localhost --port 8080 --strictPort
```

Sign in or create an account, then open **Home → Social profile** and save your
opted-in profile. **Find friends** searches handle/display-name prefixes (an
optional leading `@` is accepted). An empty search browses members of this server.
Open a result to follow or unfollow. Profile count buttons open paginated lists.

**Block member** asks for confirmation, removes follows in both directions and
hides the two members from each other. **Blocked members** on your own profile
opens your private management list. Unblocking permits visibility again only if
the other person has not blocked you, and never restores follows automatically.

## Storage and access rules

- Schema v2 adds `follows`, `blocks`, indexes in both graph directions and a
  Unicode-normalized display-name search column. Version 1 profiles, avatars,
  revisions and timestamps are preserved in an explicit migration transaction.
  A failed migration rolls back. A newer unknown schema is refused.
- Follow edges reference opted-in profiles and cascade on profile removal. Blocks
  reference account identities and deliberately survive social opt-out/recreation,
  preventing opt-out from bypassing an existing block. Actual account deletion
  removes those blocks, with startup reconciliation after an interrupted cleanup.
- `api/social/policy.js` applies a two-way block rule to direct profiles, avatars,
  member discovery and relationship lists. The server uses the authenticated
  viewer ID, never a client-supplied viewer. Hidden and missing profiles return
  the same 404. Disabled accounts are hidden without deleting their profile data.
- The sole block-policy exception is the caller's own management list, containing
  only already-known IDs/names. It grants no biography/avatar access, and keeps an
  ID available for unblocking even if the target removed their social profile.
- Counts describe graph entries visible to that viewer; blocked/disabled members
  are not exposed through counts. Private training documents are never scanned.
- Follows/unfollows and blocks/unblocks are idempotent. Self-follow and self-block
  are rejected. Following requires an opted-in profile; reading member profiles
  requires an authenticated account. Only the caller's own graph edges are writable.
- Member lists default to 20 results, at most 50. Each request scans at most 200
  candidate rows before returning a continuation. Consequently an empty page may
  still have a next cursor. Stable account-ID cursors are bound to the viewer,
  list and normalized search term; cursor values confer no access rights.
- Search matches literal prefixes: `%`, `_` and backslash do not become wildcard
  patterns. Display names use NFKC normalization and Unicode lowercase keys.
- Social reads are limited to 120/member/minute and writes to 30/member/minute.
  Avatar uploads retain their separate six-attempt budget. Limits are in-memory
  and reset when the process restarts.

`/api/config` advertises `social.graph: true` on compatible enabled servers.
Profile-only older servers still support profile editing; friend actions and
directory requests are gated on the graph capability. Local/guest accounts and
disabled or older servers retain the existing connection explanation.

Frontend graph state is scoped to the mounted server/account/list. Late responses
from a previous identity are ignored. Lists refresh on return/focus, failed access
clears displayed members, and blocking clears the displayed target before leaving
its page. There is no persistent member/avatar cache. Content already seen by a
member cannot be recalled from their memory or saved files.

## Validation

```text
node --test api/test/social-graph.test.js api/test/social.test.js api/test/server-social.test.js api/test/openapi-routes.test.js api/test/server-config-session.test.js
node frontend/scripts/check-locales.mjs
node scripts/build-api-docs.mjs --check
```

From `frontend/`:

```text
npm test -- src/views/Profile.test.jsx src/views/People.test.jsx src/lib/pt-br-locale.test.js src/App.workout-tabbar.test.jsx src/lib/finish-workout.test.js
npm run build
```

Tests cover graph idempotency, unique relationships, blocked direct URLs (including
avatars), search/cursor validation, bounded hidden-page scanning, profile opt-out,
account cleanup, schema-v1 upgrade and backup restore. Component checks cover
follow/unfollow, block confirmation, pagination, unblocking, stale identity results
and failed-access cleanup. New strings are translated across all 19 packs.

The two-account Edge browser check covers search, mutual follows, follower lists,
blocking, reciprocal hidden profiles, unblock without restored follows and a
390px layout. Node 22.23.4 compatibility checks and the production build pass.
Native camera, device pairing and container checks remain release prerequisites
from Phase 1; this change does not claim those were performed.

The full API run passed 781/812 tests: 30 previously recorded platform/fixture
failures plus one timing-sensitive wrapped-push failure that passed independently.
The full frontend run passed 7,820/7,842 tests: the previous 21 failures plus one
gym-reminder timing failure that also passed independently. All new graph/profile
checks pass. The final focused frontend run passes 43/43 tests; the Node 22 social,
migration, config and OpenAPI checks pass, including the subsequently added bounded
hidden-page test. Full-suite results are recorded here rather than reported as clean.

Back up all of `data/` with the instance stopped before migration. Schema v2 cannot
be opened by the Phase 1 server; rollback requires restoring its coordinated
pre-upgrade backup. Disabling social features preserves graph data and keeps
account-deletion cleanup active.
