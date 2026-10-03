# osm-reviewer

A review queue for OpenStreetMap POI candidates produced by an extraction pipeline.
Reviewers work a queue of candidates, accept or reject the proposed tag changes, and
the accepted ones are composed into OSM changesets.

Dates display as DD-MM-YYYY everywhere, times as HH:MM — `14-09-2026 06:12`. Never ISO.

## Stack

SvelteKit 2 on Svelte 5 (runes), Tailwind v4, Leaflet for the maps, SQLite through
Drizzle, sveltekit-superforms + Zod for forms, `@sveltejs/adapter-node` for the build.
Biome is the formatter and linter; Vitest and Playwright are the test suites. Nix
supplies the toolchain, packages the app, and ships a NixOS and a home-manager module.

The design came from a Claude Design project and is still iterated on there. The screens
are considered settled: change where data and validation live, not how a screen looks.

## Layout

- `src/routes/**` — one `+page.svelte` per screen with its `+page.server.ts` beside it.
  `+layout.svelte` is the shell and the keyboard map; `+layout.server.ts` is the auth
  guard — every route but `/login` needs a session and remembers where it bounced from —
  and loads the counts the top bar shows everywhere. `/settings` is the signed-in
  account's own (account, OSM account, shortcuts), opened from the account menu;
  `/server` is everything instance-wide (sources, areas, notifications, users,
  diagnostics), behind the gear. `/server?s=<section>` opens a section directly. Every
  account can read it; every action on it is admin-only, and users and diagnostics are
  hidden from reviewers altogether.
- `src/lib/server/pipeline/` — the in-process pipeline that fills the queue (see "The
  pipeline"). Server-only, started from `src/hooks.server.ts`.
- `src/lib/components/**` — shared markup. `areas/`, `sources/` and `settings/` hold the
  pieces of those screens.
- `src/lib/server/db/` — schema, client, migration runner, seed. Server-only: nothing
  under `src/lib/server/` may be imported from a component.
- `src/lib/server/auth/` — password hashing, sessions, and SSO: `oidc.ts` is the round trip
  to the provider, `sso-user.ts` maps the returned claims onto a row in `users`.
- `src/lib/schemas/` — the Zod schemas the forms validate against, shared by the server
  action and the client `superForm`.
- `src/lib/stores/*.svelte.ts` — client view state (selection, filters, open sheets,
  optimistic updates). These are not the source of truth; the database is.
- `src/lib/data.ts` — the original fixtures (candidates, history, users, defaults).
  **Seed data only.** Nothing at runtime reads it; `src/lib/server/db/seed.ts` does, and
  it also holds the demo sources and areas, which are real datasets and a real Lyon boundary.
- `src/styles/tokens.css` — the palette, and the only place hex values live.
- `nix/` — package, checks, source filtering and the two modules. `flake.nix` holds the
  inputs, the per-system wiring and the devShell itself.

## Data flow

Reads are server `load`s; writes are form actions. Nothing in a component queries the
database, and nothing outside `src/lib/server/` can.

- `src/lib/server/queries.ts` — the `load` half. Every screen's data comes from here.
  `loadCounts` runs in the root layout load, because the top bar and the phone nav show
  the pending and staged counts everywhere.
- `src/lib/server/mutations.ts`, `review.ts` — the action half: drafts, link
  syncing, accept/reject/undo, upload. The accept gate is enforced against the rows, not
  against anything the client sent.
- `src/lib/post.ts` — the one helper for writes behind controls that are already plain
  buttons (checkboxes, sliders, toggles). They hit the same named actions and the same Zod
  schemas; they simply have no meaningful no-JS path, unlike the forms, which do.

Forms whose fields are not flat strings — a `Record<id, boolean>` of checkboxes, a
`[lat, lon]` tuple, a `string[]` of tags — run `superForm(..., { dataType: "json" })`.
`FormData` cannot carry those shapes; superforms posts the form as devalue-encoded JSON
and `superValidate` reassembles it.

The session reviews one area at a time, picked from the top bar. The choice is view state,
not data, so it rides in a `scope` cookie (an area id, or `all`) that the picker writes and
`loadCounts` reads; the queue and review loads take the resolved scope from `parent()`. No
cookie, or one naming a removed area, falls back to the area with the most pending.

Within the scope, the queue's view — type and confidence filters, sort column and direction,
page — lives in the URL (`?type=closure&sort=conf&page=2`), parsed by
`src/lib/schemas/queue.ts`, where a value that does not parse falls back to its default
rather than failing. `loadQueue` applies all of it in SQL and fetches one page of undecided
candidates; a page past the end clamps to the last. Never filter or sort the loaded rows on
the client: a page is 50 of possibly thousands, so a client-side filter only ever sees those
50. The store exposes the view as getters over `page.data.query`, and changing it is a
`goto`, so back and forward step through views. `/review` reads the same query string and
walks the same page, stepping across into the next one at its ends.

Two bits of state are derived rather than stored, so a flag can never disagree with the
table it describes: a candidate is **staged** when its decision is `accepted` and its
`changeset_id` is null, and it is **in conflict** when `head_version` is not null.

## Sign-in and accounts

Two ways in: email + password, and OpenID Connect against `SSO_ISSUER`. SSO exists only
when an issuer is configured — no issuer, no button, and both its action and
`/login/callback` answer 404. The callback is a `+server.ts`, so the layout's auth guard
never runs for it; it refuses on its own.

`ssoUser` decides who an SSO sign-in is. The `groups` claim must carry `SSO_GROUP` (empty
disables the gate). An account is matched on the provider's `sub`, stored in
`sso_subject`; an existing row is linked by address once, and only when the provider
marks the address verified, or anyone able to edit their own email there could take over
a local account. Nobody matched means a new reviewer is created on the spot. Every refusal
travels back to `/login` as `?sso=<reason>`, which the load turns into the form's one
error line.

Admins manage accounts in the **users** pane on `/server`: create (an empty password makes an
SSO-only account that links on first sign-in), promote/demote, disable — which also
deletes the account's sessions — and delete. Delete is refused for anyone with decisions,
because `candidate_decisions.user_id` has no cascade and the audit trail needs the row;
disable them instead. None of these actions accept the acting admin's own id, and that
single rule is what guarantees an instance never loses its last admin.

Demo affordances are gated behind `dev` and built server-side — the "clear lock" button on
the login screen and the seeded-credentials hint. Neither exists in a production build, and
the hint reads the address from the database so the fixture users, which carry cleartext
passwords, never reach the client bundle.

## What the app fetches at runtime

The browser makes one external request, deliberately: **OSM raster tiles** from `tile.openstreetmap.org`,
via `darkMap()` in `src/lib/leaflet.ts`, on `/review` and the three area maps. It is the
basemap a reviewer judges a POI's position against, so it earns its place — but it does
tell the tile CDN which areas are being reviewed and when. If that ever matters, PMTiles
through `protomaps-leaflet` serves the same basemap from this origin without changing
Leaflet; dropping the tile layer entirely is cheaper but guts `/review`, whose whole job is
locating a POI at zoom 17.

Everything else the browser loads is local and should stay that way, and every host the
server calls is configuration rather than code:

- **Fonts are self-hosted** — `@fontsource/jetbrains-mono` and `@fontsource/public-sans`, weights 400/500/600,
  latin subset, imported at the top of `src/app.css`. Do not reintroduce the Google Fonts
  `<link>`: it is render-blocking, it fails silently on a LAN with no internet (the app
  then falls back to system fonts and stops looking like the design), and it reports every
  page load to a third party.
- **Leaflet is bundled**, and its marker sprites are inlined as `data:` URIs.
- **Sign-in talks to one host: the identity provider, and only while SSO is on.**
  Discovery happens on the first SSO sign-in rather than at boot, so a provider that is
  down never stops the server starting; token exchange, JWKS and userinfo follow during
  each sign-in.
- **Notification channels are operator-configured hosts**: `notify()` in
  `src/lib/server/notify.ts` posts to the ntfy server and the webhook URL and speaks SMTP to
  the relay (`smtp://`/`smtps://`, credentials allowed, or a bare `host:port`), all from the
  Notifications pane, and only for channels that are on. It never throws — a dead channel is
  logged — and the `queue` event fires once per crossing of the ceiling (the latch is in
  memory). Webhook bodies carry `X-Signature: sha256=<HMAC-SHA256 of the raw body>`.
- **The pipeline's hosts are configuration, not code**: `OVERPASS_URL`, `NOMINATIM_URL`,
  `OSM_URL` (default the dev sandbox, so an unconfigured instance cannot write to the live
  map), the model at `LLM_URL`, and each source's own endpoint. All are read in
  `src/lib/server/config.ts`, and `PIPELINE_ENABLED=false` switches off the scheduler and
  every fetch at boot — the e2e run sets it so the suite stays offline. Every call carries a
  timeout, and a failure is a recorded run or upload failure, never a crash. Calls to the OSM
  family (Overpass, and the sites a crawl reads) send `osm-reviewer/<version> (+<ORIGIN>)`
  as their User-Agent, so set `ORIGIN` to something an operator of those services can
  contact.
- **Boundary search goes through the server.** The area form's relation picker calls
  `GET /server/boundaries`, which asks `NOMINATIM_URL` (`src/lib/server/nominatim.ts`) — the
  browser never does, so the visitor's address stays off Nominatim and one process-wide
  throttle (1 request/s, plus a five-minute cache) keeps the instance inside the usage policy.
  The area's size is the bounding box's, which overstates the boundary; the picker says
  "bbox", and POI counts stay "—" until a run counts them.
- **The OSM API is the second host, only for a signed-in reviewer's own actions**
  (`src/lib/server/osm/`): the OAuth2 round trip (authorization code + PKCE, scopes
  `read_prefs write_api`, needs `OSM_CLIENT_ID`; without it the connect button says not
  configured and nothing else changes), and the upload. The access token is stored as-is in
  `user_settings`, the database being the trust boundary. An upload first reads each object's
  current version: one moved past the candidate's base is a conflict and nothing is sent. Then
  per `osmPerChangeset` batch it creates a changeset, posts an osmChange built from the
  *current* element with the accepted tag ops applied, and always closes it. A closure is
  written as the `disused:` key its candidate carries, and the bare key it replaces is
  dropped. A failed batch is a `changesets` row with a null `osm_id` and the error, and its
  decisions stay staged. The diagnostics page probes `/api/0.6/capabilities.json` only when a
  client id is set.
- Links to `openstreetmap.org` on `/review` and `/history` are anchors; they fetch nothing
  until clicked.

## The pipeline

Sources are read by a runner inside the server process, not a separate worker: one run at a
time, process-wide, started by a one-minute timer (`startPipeline`, after migrations, only
while `PIPELINE_ENABLED` is not `false`) or by a "run now" / "run pipeline" button, which
only sets `sources.run_requested_at` and nudges the runner. An explicit request ignores
`enabled`, the failure hold and the clock; the clock honours `next_run_at` (null on an enabled
source means due). The run claim is `running_since`, cleared at boot and ignored once it is
three hours old, so a crash cannot wedge a source.

A run is source × linked area. A **registry** is streamed once for every area (the IRVE file is
158 MB and never in memory; a data.gouv.fr dataset URL is resolved to its current CSV, because
the file URL changes with every publish). An **api** is an Opendatasoft explore v2.1 endpoint,
paged by 100 and switched to the `jsonl` export past the 10 000 offset ceiling. A **crawl**'s
seed rule is either URLs or `key=*` on OSM POIs (`website=*`): the pages OSM already points
at, same host only, robots.txt honoured, the budget and per-host delay read from the free
text, and only the model extractor reads them. Relation areas are cut by their bounding box
while a source is read, which lets in a neighbour's corner of the box; the OSM side uses
Overpass's exact `area`.

The **deterministic** extractor is a preset (`presets.ts`): `irve` and `annuaire-education`,
named on the source or detected from the columns, and a source that fits none fails its run
rather than guessing. The **model** extractor sends one record or page per call
(`llm.ts`; OpenAI-compatible `/chat/completions` with a JSON schema, or the Anthropic Messages
API with structured output, both by plain `fetch`) and treats the answer as a witness: a tag
survives only if its quote is really on the page, its key matches the source's allowed
patterns and its confidence clears the floor, which is also capped.

Matching asks Overpass once per area for the source's `matching` selector plus whatever main
tag the records carry (a filter written for `amenity=school` still finds kindergartens), then
matches by shared ref (`ref:EU:EVSE`, `ref:UAI`, `ref:FR:SIRET`) before distance and name.
Candidates upsert on `(source_id, source_record_key)`; a record whose `content_hash` is
unchanged is left as the reviewer saw it, and a queued candidate whose OSM object has a newer
version than its base is flagged in conflict instead of being silently recomputed. A candidate
with a decision is never touched, and one the source no longer lists is swept only if
undecided and only after a run that read the source to the end (a crawl never sweeps).

Three failed runs in a row hold a source (`failing`) until someone runs it by hand; a failed
run retries in an hour. The licence on the source travels in each evidence row's `kind`.

## Conventions

**Duplication goes into `src/lib/` (logic) or `src/lib/components/` (markup).** If the
same thing appears twice, factor it. Equally: do not build the abstraction before the
second use exists. YAGNI applies to helpers, wrappers and options alike.

**Comments only where the code cannot speak for itself.** A comment earns its place for a
non-obvious choice, a workaround, an ordering constraint, or a trap — not for restating
what the line does. If a better name would remove the question, rename instead.

**Styling is Tailwind utilities over the tokens.** No hex values in components. A missing
colour means a new token in `src/styles/tokens.css` and a mapping in the `@theme` block in
`src/app.css`; the hex lives in the token file only.

**A repeated class string is declared once, through Tailwind's own pipeline.** When the
same run of utilities describes the same thing in more than one place — a section label, a
rail row, a status pill — it becomes an `@utility` in `src/app.css` built on the tokens,
not a string copied into each component. `no-scrollbar` is the existing example; written as
`@utility`, it still takes the responsive and state variants, which a plain class in a
`<style>` block would not.

Where the variation is behavioural rather than visual — on/off, ready/not — it belongs in
`src/lib/format.ts` as a helper returning the class string (`ghost`, `boxBtn`,
`primaryBtn`, `INPUT`). Same rule as everywhere else: `@utility` for a thing that looks the
same in several places, a `format.ts` helper for a thing whose classes depend on state, and
neither until it actually repeats.

**Motion comes from `src/styles/motion.css`** — `m-fade`/`m-pop` (110ms), `m-rise`/`m-lift`
(150ms), `m-sheet` (240ms), `m-push`/`m-back` (200ms, a rail drilling into a list and
backing out), each with an `-out` partner, plus `m-grow` (200ms, a size transition for a box
resizing in place), all disabled under `prefers-reduced-motion`.

**Do not use Svelte `transition:` directives.** An outro holds the node in the DOM until
its animation reports finished, and in a throttled or backgrounded tab that report never
arrives — the overlay is then stuck and the app is unusable. Mount and unmount on state;
where an exit needs to be seen, set a `closing` flag, apply the `-out` class, and drop the
state on a `setTimeout` of the same length. `TopBar`, `BottomNav` and `QueueFilterSheet`
are the worked examples.

**Three layouts, not one**: phone (402), tablet (834), desktop. The queue row, the review
pane and the sources/areas rails each change shape between them, and the evidence gutter
exists only at `lg`. A change to a screen is not done until it has been looked at in all
three. JS width reads go through `$lib/stores/viewport.svelte`, never `window.innerWidth`.

## Working on it

Everything runs from the devShell (`direnv allow`, or `nix develop`). The shell prints its
own menu: `dev`, `check`, `lint`, `fmt`, `test`, `e2e`, and `build` / `image` /
`chart-push` for the Nix package, the Nix-built OCI image (loaded into podman or docker) and
the Nix-packaged Helm chart, and `release` to cut a release (see "Container and chart").

| | |
|---|---|
| `pnpm dev` | dev server |
| `pnpm build` | production build into `build/` |
| `pnpm check` | `svelte-check` |
| `pnpm lint` / `pnpm format` | Biome, check and write |
| `pnpm test` | Vitest unit suite |
| `pnpm test:e2e` | Playwright |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` | Drizzle |

Dependencies are kept at latest; install with bare `pnpm add` rather than hand-written
ranges. There is no pre-commit; the quality gates are the flake checks.

### Things that will trip you up

**TypeScript needs both 6 and 7 installed.** `svelte-check` refuses TS 7 alone, so the repo
has `typescript@~6` plus `@typescript/native` (TS 7) and checks run with `--tsgo`. Dropping
either one breaks `pnpm check`.

**Biome reads the `<script>` block of a `.svelte` file and nothing else.** It formats that
block as a standalone document, which is why script contents sit flush against the left
margin rather than indented under the tag. Because it never parses the markup, the
usage-based correctness rules (`noUnusedVariables`, `noUnusedImports`,
`noUnusedFunctionParameters`) are switched off for `.svelte` in `biome.json` — otherwise
every prop used only in the template is reported as dead.

**The migration-copy plugin must stay last in `vite.config.ts`.** The node server applies
migrations at boot, so `build/` has to carry `drizzle/`. The adapter wipes and rewrites
`build/` from its own `closeBundle`, and Vite runs those hooks in plugin order — put the
copy plugin before `sveltekit()` and the migrations vanish from the output.

**`biome.json` skips `src/app.css`.** Biome's CSS parser does not understand Tailwind v4's
`@theme` and `@utility` at-rules and reports them as syntax errors. The other stylesheets
are plain CSS and are checked normally.

**A settings pane must never write another pane's fields.** The account's panes save into
one `user_settings` row, and the notifications pane into the single `instance_settings` row,
independently, so every column carries a default — an insert triggered by one pane cannot be
allowed to decide another's values. `Pane.svelte` keeps each pane's
save bar wired to its own form through the HTML `form=` attribute rather than by nesting,
because wrapping the pane in a form breaks the `min-h-full` chain its sticky footer needs.

**A build sandbox has no fonts, and Chromium then measures every glyph as zero wide.**
Anything sized by its own text collapses to an empty box, which Playwright reports as
`hidden` — the element is in the DOM with the right text and simply never becomes visible.
Elements with padding survive, which makes the failure look arbitrary. The `e2e` check
therefore sets `FONTCONFIG_FILE` to a fonts.conf carrying JetBrains Mono and Public Sans, and `e2e/global-setup.ts`
measures a string before the suite runs so a fontless environment fails in one sentence
instead of fourteen timeouts. `playwright-driver.browsers` ships no fonts of its own.

**`nix build` only sees what jj has snapshotted.** The flake source is the git tree, so a
file that exists only in the working copy is invisible to a check — it fails with something
misleading like "No tests found". Any `jj` command snapshots and exports. Rule out a stale
sandbox source before concluding a fix "didn't apply".

**`@playwright/test` is pinned to the exact version of the Nix `playwright-driver`.** The
browsers come from the Nix store via `PLAYWRIGHT_BROWSERS_PATH`, and Playwright rejects
browsers whose revisions do not match its driver. Bumping one means bumping the other.

**`better-sqlite3` ships prebuilt binaries in its tarball** — it must not be built from
source. `pnpm-workspace.yaml` sets `allowBuilds.better-sqlite3: false` deliberately: the
node-gyp rebuild fails here and buys nothing, because the bundled prebuild is what loads.
When drizzle-orm 1.0 ships with its `node-sqlite` driver, this dependency and that entry
can both go.

**A rune store must not hold server data in `$state`.** The stores expose getters over
`page.data`; they do not copy it into `$state` from an `$effect`. Two things break if they
do: effects never run during SSR, so the first paint renders empty (`0 shown`, `rows 1–0 of
0`), and a module-level `$state` singleton populated on the server is shared between
concurrent requests — one visitor's queue can be served to another. `$state` in these
stores is for genuinely client-side things only: selection, filters, which sheet is open,
the in-flight drag buffer.

**`!**/build` in `biome.json` matches absolute paths.** Inside a Nix build the working
directory *is* `/build`, so the pattern swallows the entire tree and Biome reports that no
files were processed while still exiting non-zero. The `lint` check therefore runs Biome
against the store path in place rather than against a copy.

## Database

SQLite, one file, path from `DATABASE_PATH` (dev default `./data/osm-reviewer.db`). WAL is
on, so the directory must be writable — not just the file. Migrations are generated with
`pnpm db:generate` and committed; they are applied at server startup from
`src/hooks.server.ts`, so a deployment has no separate migration step.

`.env.example` lists the whole environment surface — `DATABASE_PATH`, adapter-node's
`HOST`/`PORT`/`ORIGIN`/`BODY_SIZE_LIMIT`, the `SSO_*` provider settings
(`SSO_CLIENT_SECRET` is the one secret among them; unset makes a public client protected by
PKCE alone) and the `SEED_ADMIN_*` overrides. Two more are set by the packaging rather than
the operator: `OSM_REVIEWER_REV` (the commit, from the Nix package and the Dockerfile) and
`OSM_REVIEWER_IMAGE` (from the Nix image and the chart). SSO is off unless
`SSO_ISSUER` is set, and `SSO_ENABLED=false` switches it off even then — which leaves an
account with no local password no way in. `src/lib/server/config.ts` is where the
identity-provider, seed, pipeline, OSM, LLM and backup values are read. SMTP is the
exception: the relay is an operator-edited instance setting, not environment.

Nothing the running app shows is fixture text. `src/lib/server/instance.ts` measures the
instance — version from `package.json`, uptime, the database file, free disk, source health,
an identity-provider probe, the pipeline worker, the OSM API, backups — and anything with
nothing behind it yet says **not implemented** or
**not configured** on screen, through an inert `INERT_BTN` control where it was a button.
The Claude Design prototype keeps its mock values; this app does not.

Backups are `src/lib/server/backup.ts`: with `BACKUP_DIR` set, a timer (started from
`hooks.server.ts`, off under `PIPELINE_ENABLED=false`) takes a better-sqlite3 online backup
every `BACKUP_INTERVAL_HOURS` into `osm-reviewer-<UTC stamp>.db`, never two at once, and
keeps the newest `BACKUP_KEEP`. The first one waits out the interval since the newest file
on disk, so restarts do not multiply snapshots. The NixOS module and the chart do not set it;
point `BACKUP_DIR` at a volume (a `StateDirectory` sibling, a second PVC) yourself, since a
snapshot beside the database it protects survives nothing. The diagnostics bundle
(`/server/diagnostics`, admin only) is instance facts, health and config as JSON, with every
key named like a secret, token, key or password blanked and URL credentials stripped by
`redact`: redaction is by name, so a new secret in `config.ts` is covered if it is named like one.
Vite loads `.env*` for `pnpm dev`; the scripts
that run outside it (drizzle-kit, `db:seed`) get the same files through `loadEnvFiles` in
`src/lib/server/env.ts`. Precedence is shell over `.env.<mode>` over `.env`, and the e2e run
leans on that: `e2e/env.ts` hands the server and the seed every variable the suite asserts
on, because both run without `NODE_ENV` and would otherwise read a developer's
`.env.development` — which renames the seeded admin and switches SSO off. `e2e/sso.spec.ts`
runs a mock provider (`oauth2-mock-server`, in `e2e/idp.ts`) inside the test process, so
each test sets the identity it hands back.

A production build has no seed, so the first account comes from `bootstrapAdmin`
(`src/lib/server/db/bootstrap.ts`): at boot, after migrations, it creates one admin from
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` — but only while the users table is empty, so leaving
them set never resets a password changed in the app.

Derived rather than stored, because storing them twice would let them disagree: a user is
SSO-only when `passwordHash` is null, a candidate is in conflict when `headVersion` is not
null, and its age and staleness come from `fetchedAt`. An area's pending count, accepted-in-30-days
and status come from its candidates, decisions and `paused`/`lastRunAt`; a source's config
rows and metrics are built in `source-display.ts` from its columns, runs and decisions, and
the per-area yield from the candidates. Nothing in a table is display text.

Times are `integer({ mode: "timestamp" })` and come back as `Date`, durations are
milliseconds and counts are integers — all formatted at the edge (`src/lib/format.ts`).

A source stores its real configuration (`endpoint`, `apiKey`, `schedule`, `matching`, …); the
screens only ever see the key's last four characters. The key and an account's `osmToken` are
stored as-is: the database is the trust boundary, as it already is for `webhookSecret`. A
candidate is identified by `(sourceId, sourceRecordKey)`, which is what a re-run upserts on;
`osmId` is null for a POI OSM does not have yet.

## Nix

`nix develop` for the shell, `nix build` for the app, `nix flake check` for the gates
(`formatting`, `lint`, `types`, `unit`, `e2e`, `chart`). Three inputs and no flake framework:
`nixpkgs`, `numtide/flake-utils` for the per-system iteration, and `numtide/devshell` for
the shell — which is defined inline in `flake.nix`. The rest lives in `nix/`, with
`nix/source.nix` providing three filtered views of the tree: the dependency fetch sees only
the manifests, so editing app code does not invalidate it.

The systems are named (`eachSystem`, not `eachDefaultSystem`) because the package is
`meta.platforms = linux` and both modules are Linux-only — emitting darwin attributes would
only give `nix flake check --all-systems` things it cannot evaluate.

Each check runs the project's own script rather than a Nix re-spelling of it, so there is
one definition of "typechecks" and it lives in `package.json`.

`nixosModules.default` runs the app as a hardened systemd service under `DynamicUser` with
a `StateDirectory` for the database; `homeModules.default` is the user-level equivalent
under `$XDG_STATE_HOME`. Two hardening settings are deliberate and commented in the
module: `MemoryDenyWriteExecute` is **off**, because V8 maps JIT pages write-then-execute
and turning it on kills Node at startup, and `RestrictAddressFamilies` includes
`AF_NETLINK`, because glibc's `getaddrinfo` opens a netlink socket to probe IPv6.

There is a NixOS VM test that boots the unit and curls it, but it is **not** registered as
a flake check — `nix flake check` would then require `/dev/kvm` and fail on machines
without it. Run it deliberately instead.

The package carries no `meta.license`: there is no LICENSE file in the repo, and one was
not invented. Add the file and the attribute together.

## Container and chart

There are two images on purpose. `packages.image` (`nix/image.nix`) is built from the Nix
package and is what the container modules run: `nixosModules.container` adds
`services.osm-reviewer.container`, which defines `virtualisation.oci-containers.containers.osm-reviewer`,
and `homeModules.container` defines the same as a rootless `services.podman.containers` quadlet.
Both load the Nix image before start (`imageStream`; home-manager has no equivalent, so its
unit gets an `ExecStartPre` that pipes the stream into `podman load`) and accept a registry
image instead with `imageStream = null`. They refuse to be enabled alongside the native
`services.osm-reviewer`.

`Dockerfile` builds the OCI image on `node:<version>-alpine`, independently of the Nix package —
`better-sqlite3` ships `linuxmusl` prebuilds, so nothing compiles. The base is pinned by
`NODE_VERSION` **and** `NODE_DIGEST` (the digest is what resolves, so bump both), at the same
node version as the flake's nixpkgs. On top of the pin, the runtime stage runs `apk upgrade` so
OS security fixes are not held back, and deletes npm, corepack and yarn: the server never calls
them, and their vendored dependencies are what the CVE scan fails on. `chart/` is the Helm chart:
one replica with `Recreate`, fixed rather than configurable, because SQLite on a
ReadWriteOnce volume allows exactly one writer; `origin` is required and the Ingress and
HTTPRoute take their hostname from it. The PVC is annotated `helm.sh/resource-policy: keep`.
The app and the chart are released separately, on their own versions, and both are cut
with `release` (`scripts/release.sh`; no arguments prints the usage). `release app X.Y.Z`
regenerates `CHANGELOG.md` and sets `version` in `package.json`, commits both as
`docs(changelog): vX.Y.Z` on their own revision, advances `main`, then tags `vX.Y.Z` and pushes
`main` and the tag. `release chart X.Y.Z` does the same with `chart/Chart.yaml` and
`chart/CHANGELOG.md` as `chore(chart): chart vX.Y.Z`, tagged `chart-vX.Y.Z`. Each is two halves
(`app-changelog`/`app-tag`, `chart-bump`/`chart-tag`); run them apart to read the changelog
before the tag goes out. The script refuses a non-empty working copy, since that revision
becomes the release commit, and the tag halves check `main`, not the working copy.

Changelogs are generated by git-cliff from conventional commits — never hand-write entries.
`cliff.toml` is the app's (`v*` tags, `chart/**` excluded by path and `(chart)`-scoped commits
skipped), `cliff.chart.toml` the chart's (`chart-v*` tags, `chart/**` only, `chore(chart)` and
`chore(deps)` listed). They are separate files only because `commit_parsers` differs and git-cliff
takes it from no flag or env var; the templates are duplicated, so keep them in sync. The
repository URL is written into the templates rather than taken from `[remote.github]`: that
section makes git-cliff call the GitHub API, which 404s on this private repo without a token.

`image.yml` builds the image on every push to `main` (tag `edge`) and on `v*` tags (semver
tags and `latest`, then the GitHub release, which waits for signing so it never announces an
image that is not there). Each platform builds on its own native runner and is pushed by digest
only; grype then gates it on fixable high/critical CVEs before any tag points at it. The merged
manifest is signed keyless with cosign and carries an SPDX SBOM attestation. A `chart-v*` tag
runs `release-chart.yml` (chart to
`oci://ghcr.io/datahearth/charts`, failing unless the tag matches `Chart.yaml`, then a GitHub
release with `--latest=false` so it never displaces the app's). Both release bodies come from
`.github/actions/release-notes`, the same composite action as `../streamline`: it extracts the
version's changelog section and has the Claude CLI rewrite it, in a `notes` job holding only a
read-only token because the CLI installer is an unpinned `curl | bash`. The model is never
load-bearing — without the `CLAUDE_CODE_OAUTH_TOKEN` secret, or on empty output, the raw section
ships — but a missing section fails the release. The chart has no `appVersion` and does not pin
an app release: `image.tag` is required, so the installer always picks one. `packages.chart`
(`nix/chart.nix`) runs the same `helm package` in the sandbox, and `chart-push` builds it and
pushes it, after a `helm registry login ghcr.io`.

## Version control

This repo uses **jj**, not git. `jj st`, `jj diff`, `jj describe`, `jj new`, `jj squash`,
`jj split`, `jj rebase`, `jj git fetch` / `jj git push`. The `.git` directory exists only
because the repo is colocated.
