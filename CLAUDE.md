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
  `+layout.svelte` is the shell and the keyboard map; `handle` in `src/hooks.server.ts`
  is the auth guard (`src/lib/server/auth/guard.ts`) — every route but `/login` and its
  callback needs a session and remembers where it bounced from. A layout load cannot be the
  guard: a `__data.json` request can ask for the page's load alone. `+layout.server.ts` keeps
  the same redirect for the client and loads the counts the top bar shows everywhere. `/settings` is the signed-in
  account's own (account, OSM account, shortcuts), opened from the account menu;
  `/server` is everything instance-wide (sources, areas, notifications, users,
  diagnostics), behind the gear. `/server?s=<section>` opens a section directly. Every
  account can read it; every action on it is admin-only, and users and diagnostics are
  hidden from reviewers altogether.
- `src/lib/server/pipeline/` — the in-process pipeline that fills the queue (see "The
  pipeline"). Server-only, started from `src/hooks.server.ts`. `match/` is matching, `any/` and `fr/`
  hold the kits (code only one kind has) and everything read from France.
- `src/lib/components/**` — shared markup. `areas/`, `sources/` and `settings/` hold the
  pieces of those screens.
- `src/lib/server/db/` — schema, client, migration runner, admin bootstrap. Server-only: nothing
  under `src/lib/server/` may be imported from a component.
- `src/lib/server/auth/` — password hashing, sessions, and SSO: `oidc.ts` is the round trip
  to the provider, `sso-user.ts` maps the returned claims onto a row in `users`.
- `src/lib/schemas/` — the Zod schemas the forms validate against, shared by the server
  action and the client `superForm`.
- `src/lib/stores/*.svelte.ts` — client view state (selection, filters, open sheets,
  optimistic updates). These are not the source of truth; the database is.
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
  against anything the client sent: an address, and a `contact:*` key moved to `addr:*`, are
  accepted whole or not at all.
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
`/login/callback` answer 404. The callback is exempt from the session guard, since it is
how a session starts; it refuses on its own.

`ssoUser` decides who an SSO sign-in is. The `groups` claim must carry `SSO_GROUP` (empty
disables the gate). An account is matched on the provider's `sub`, stored in
`sso_subject`; an existing row is linked by address once, and only when the provider
marks the address verified, or anyone able to edit their own email there could take over
a local account. Nobody matched means a new reviewer is created on the spot. For the same
reason a reviewer cannot change their own address while SSO is on (`emailLocked`): naming
someone's address before their first sign-in would share their account. Every refusal
travels back to `/login` as `?sso=<reason>`, which the load turns into the form's one
error line.

Admins manage accounts in the **users** pane on `/server`: create (an empty password makes an
SSO-only account that links on first sign-in), promote/demote, disable — which also
deletes the account's sessions — and delete. Delete is refused for anyone with decisions,
because `candidate_decisions.user_id` has no cascade and the audit trail needs the row;
disable them instead. None of these actions accept the acting admin's own id, and each
refuses, inside its own transaction, a write that would leave no enabled admin: the first
rule alone does not hold when two admins demote each other at once.

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
  `BAN_URL` (the national address base, asked once per school or station address, and once more
  without the postcode when that misses: a proposed address takes its spelling when the base
  names the same street, or is dropped whole, with a bis or ter housenumber written spaced as
  local mappers do; a hit scored under 0.7 still counts down to 0.5 when it is the source's own
  housenumber on a street holding all the source street's words ("rue Rebatel" in Rue Docteur
  Rebatel); a school's point more than 1 km from its housenumber moves there unless
  something matches it where it stands or the base found another street, and a record moved out
  of the area is dropped and counted in the run's message. A station's point moves (100 m) only
  when the registry gives it to four decimals or fewer: a precise one stays, is matched at its
  address only when nothing matches where it stands, and a new one says how far its address is,
  unless a housenumber in its own postcode lies more than 2 km off, which moves any point; a
  postal box or CEDEX in the station's address is dropped before asking),
  `OSM_URL` (default the dev sandbox, so an unconfigured instance cannot write to the live
  map), the model at `LLM_URL`, and each source's own endpoint. All are read in
  `src/lib/server/config.ts`, and `PIPELINE_ENABLED=false` switches off the scheduler and
  every fetch at boot — the e2e run sets it so the suite stays offline. Every call carries a
  timeout, and a failure is a recorded run or upload failure, never a crash. Calls to the OSM
  family (Overpass, and the sites a crawl reads) send `osm-reviewer/<version> (+<ORIGIN>)`
  as their User-Agent, so set `ORIGIN` to something an operator of those services can
  contact.
- **The company register is the pipeline's one more host, for defibrillators only.** `SIRENE_URL`
  (default `https://recherche-entreprises.api.gouv.fr`, no key) is asked by `fr/sirene` for the
  SIREN the Géo'DAE file names, once per SIREN an hour, at most six requests a second process-wide, 10 s
  timeout. The operator and `operator:ref:FR:SIREN` are proposed only when the register calls it a legal
  entity (a legal category other than 1, the individual entrepreneur): the file's own name column can
  hold a natural person and cannot say. A function is synchronous, so `warmers` in `fr/functions.ts`
  fetch before `extract` and the function reads the cache; a lookup that fails proposes nothing and is
  counted in the run's message, never an error.
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
  *current* element with the accepted tag ops applied, and always closes it. One upload runs
  at a time, and an undo is refused meanwhile. Candidates on one object go out as a single
  modify (refused when two write one key differently), and an object the ops would leave as it
  is gets no modify at all. A diff that got no answer is not assumed lost: the changeset is
  closed and read back, and counts as uploaded when it holds changes. One that cannot be
  settled is parked (a `changesets` row with result `unknown` holding its decisions, so they
  are neither staged nor resent) until a later upload or composer load reads it back. A closure is
  written as the `disused:` key its candidate carries, on the record's own main key, and the
  bare key it replaces is dropped. A failed batch is a `changesets` row with a null `osm_id` and the error, and its
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
the file URL changes with every publish; its "unchanged" answer is asked for only after an ok
run over the same areas, configuration and app version, and never on "run now"). An **api** is an Opendatasoft explore v2.1 endpoint,
paged by 100 and switched to the `jsonl` export past the 10 000 offset ceiling. A **crawl**'s
seed rule is either URLs or `key=*` on OSM POIs (`website=*`): the pages OSM already points
at, same host only (redirects are followed by hand under the same rule), public addresses
only (each request is pinned to the address that was checked), robots.txt honoured, the budget and per-host delay read from the free text, and only the
model extractor reads them. A read that returns no rows at all sweeps nothing. Relation areas are cut by their bounding box
while a source is read, which lets in a neighbour's corner of the box, and matching fetches
OSM over that same box: cut by the exact `area` instead, a neighbour's records find nothing to
match and all come out as duplicate "new" POIs. Only the "POIs watched" count uses the exact
`area`, over the main keys: the legacy seven and each mapping's `matching.main`, the one list that also decides what a bare building is.

The code is in three layers, and a country only adds to the last. The run (`runner.ts`,
`process.ts`, the readers, `store.ts`) and matching (`match/`: `find.ts` picks the object,
`ops.ts` and `plan.ts` what is written to it, `warnings.ts` the banner, `refs.ts` the identifier
schemes, `grounds.ts` the shell's grounds) name no dataset. What matching has to know about a
kind of place is **declared in the mapping**: its `matching:` block holds the main keys, which
values stand for one another (`kin`), the building a place may be mapped as only (`shell`), what
it may be mistaken for (`lookalikes`) and how each identifier behaves (`refs`: aliases, what to
fetch, whether it names a site, whether another's id rules an object out, whether it is never
replaced, whether it names the organisation). `match/kinds.ts` reads every mapping once, lazily,
into the registry the engine asks; nothing evaluates it while modules load. A kind that needs
code owns one **kit**, named by `matching.kit` and registered in `kits.ts` (`any.charging_station`
in `any/charging-station.ts`, `fr.school` in `fr/school.ts`): a record's rule is its own kind's kit,
else the engine's default. A kit never runs on another kind's records, and a kind that declares no
kit gets none: school grounds and EVSE sockets have no business on a defibrillator. `validate`
checks the block. A kind with nothing
special writes `main: [...]` and no kit: `FR:defibrillator`, read from Géo'DAE (`sources/fr/geodae.yaml`, the
register on data.gouv.fr), is that kind and has one function of TypeScript on its path, `fr/sirene`. Its ref is a tag with
`ref: true` and one rule, `site`: two objects carrying one id are one device mapped twice, so they
get the "Same site" line. No `rules_out`, so another value of `ref:FR:GeoDAE` on an object never
rules it out (the register renumbers devices), and it proposes no `name`: `Extraction.name` is also what matching
scores against a named object, so a display name would stop an unnamed record matching the
"Défibrillateur" node 10 m away. `record.label` is its display name instead (the operator's location
note, else the commune): the queue, the review title and the twin and "Also matched by" lines show
`label || name`, while matching reads `name` only. The candidate's `name` column holds what is shown, as
it does for every kind. A device the register marks "Supprimé définitivement" is a closure
(`record.closed`), not a skipped row: it writes `disused:emergency=defibrillator` on the node it
matches, and nothing where it matches none. The reviewer's context list is pinned
(`match/context.ts`) because it is display; a mapping's `context` only appends keys to it, so
`defibrillator:location` and `ref:FR:GeoDAE` show for a defibrillator and no other kind's order moves.
Everything French is in `fr/`: the IRVE file's declarations (the
source's steps, registered in `functions.ts` beside the functions), the address base (`ban.ts`,
reached only through `COUNTRIES` in `country.ts`, by the mapping's country code), the
data.gouv.fr dataset pages (`datagouv.ts`), French spelling (`text.ts`, `school-name.ts`,
`words.ts`) and the school kit (`school.ts`). A new
dataset is a mapping file and a shipped renaming of its columns (`mappings/`, `sources/`), read by
the one `Extractor` (`extractor.ts`), with code only for what no rule can say: a **function** the
mapping names (for a tag, or on `record` for skipping a row, the other sites' values and notes) or
a **step** the renaming declares to rebuild and join rows before the renaming (the IRVE
declarations). Both are registered in `fr/functions.ts`, and `validate` refuses a file that names
one that is not. A new identifier is one entry in a mapping's `matching.refs`. The generic part still
imports `fr/` directly, since France is the only country: `rg 'fr/' src/lib/server/pipeline -g
'!**/fr/**'` lists every place a second country would have to be chosen by area instead.

A change that must not alter what is proposed is checked with `scripts/audit/golden.mjs`: it
rebuilds the queue on a copy of the database with every HTTP answer recorded to disk, so the
run before the change and the run after read the same world and their two dumps can be diffed.

A source whose columns are not the ones the app ships a renaming for (`sources/fr/*.yaml`, written
for the Annuaire and the IRVE file) is read through a **column renaming**: which of its columns is
which input of the mapping (`FR:school`), which a step of the shipped source reads, and which
nothing reads. It is made by the model, once, at the point a run first meets the data (`renaming.ts`:
the first 20 rows of a registry or API read, whose columns are the header for a CSV and the union
over the sample for jsonl), and stored in `source_renamings` with the exact list of columns it was
made for. Precedence when a read's columns arrive: all inside the shipped renaming's columns, so
shipped and no call (a superset match, since that list spans the register's history); else exactly
the stored list, so stored and no call (a column gone is a change); else, or on a pending "rename
again", the model. The answer is checked before anything is stored (`checkAnswer`: every column
answered once, only declared inputs and shipped steps named, nothing sent twice, the key and the
position supplied, and sample values that read as the phone or the place their input says), and one
that fails its checks, or a missing model, fails the run and leaves the old renaming and the request
standing. A renamed source is evaluated by the mapping's own rules, without the overrides of the
shipped source (the Annuaire's start_date rule): an official source gets its shipped program. A
column that only appears past the sample is left out of the run and counted in its message; read
through a stored or model renaming it is also remembered (`late_columns`, part of the column list of
every later stored-renaming match) with a rename request, so the next run asks the model about it.
The shipped test looks at the read's own columns alone, and a shipped read sets no request. The
"rename again" button sets `rename_requested_at`; it is inert, with its reason, where no model is
configured or where the last read used the shipped renaming (`renaming_used`), and the action
refuses the same way. A run clears only the request it started with.

An **official source** is a shipped source that meets the checklist in its file's `official:`
block: published by the organisation that runs or regulates the places, under a licence OSM can
use, at a stable address, with a link to the OSM community's page on it, and the values a
`sources` row starts with (kind, endpoint, schedule, matching, floor, allowlist; the mapping is the
file's own). `validate` refuses a block without all of it. The block is optional: a file without one only
ships the column renaming and is never offered (`fr/irve` has none, since the publisher is retiring
that dataset's address). `/server`'s sources rail offers each one
no row is made from yet ("switch on", action `officialAdd`, through `sourceDraftSchema` and
`applySourceDraft`, which also writes the licence). Whether a row is official is derived on every
read (`officialFile` in `server/official.ts`): a deterministic row whose endpoint is the file's
(or one in its `formerEndpoints`, for a dataset that moved) and whose kind of place is the file's
mapping. Nothing is stored, so editing either takes the mark off. The review screen shows it
beside the source with the tags the shipped renaming overrides, which apply to any source read
through it and to none read through a renaming the model made.

The **deterministic** extractor is `Extractor` (`extractor.ts`), built once per table of columns,
which is the shipped renaming's or a stored model one, over the mapping named on the source (an
older row may hold the name of its shipped source, `irve` or `annuaire-education`); a source that
names none is read through the shipped source whose columns hold the read's, and one that fits
none fails its run rather than guessing. A record goes rows, steps, column renaming, mapping, and
everything after the renaming reads inputs, never a column: the mapping's `record` block gives
its key, position and skip, the line to ask the address base for (`address`, `farM`, `wrongM`),
which of a key's rows is its main site (`pick: nearest`), the name and address the review screen
shows, and which inputs count as withheld; each tag's evidence is the inputs its rule read or its
`quote`, shown under the table's own column names, so a source renamed by the model quotes its
columns, not the register's. Where the source is not sure, the mapping proposes nothing rather than a
guess: no socket output above what the connector can deliver (43.5 kW on type 2, 400 kW on
CCS and CHAdeMO, where the registry holds cabinet totals, and no type 2 output from a DC unit's
own type 2 outlet), a type 2 point whose `cable_t2_attache` is blank (in its newest declaration
that states it) counted as a socket only where OSM has no type 2 count, no socket counts for a
station its own name calls DC (`Borne DC`, `rapide`) that ticks no DC connector, no opening
hours where a day's spans overlap (a day named again after `;` or `,` is one split day), no `network` that is the site's
own name, no `owner` where a site's stations name different owners or the object's
`owner:ref:FR:SIREN` is another's, no school `start_date` from the register's bulk entries or a
merged primaire, and no station `start_date` on an object first mapped more than 90 days before it: the
registry's date is its current operator's, so that one is a re-commissioning (version 1 is read
from `OSM_READ_URL` for an object edited since; unknown means no date). This is a stand-in:
the real opening date is in older versions of the consolidated file, still to be mined. The
directory's medico-social institutes become `amenity=social_facility` (the main tag of one
already mapped is left alone), its sections housed in a parent establishment are skipped (a
SEGPA however it is attached, a lycée's SEP or SEGT attached as an annex at its parent's
address), and "hors contrat" is dropped from school names, since OSM has no key for it and
mappers drop it. A UAI's rows count as several sites only where their addresses or points
differ. A school's address is the directory's line as the national address base reads it: street,
postcode and city in its spelling, the housenumber (a range "20-28" included) the directory's,
or no address at all when the base is not sure or names another street; a street spelling a
day out ("Onze Novembre") is the mapper's "11 Novembre". A person's mailbox (first.last, or a
single word that is neither a role nor the school's name, place or domain), a webmail mailbox
naming neither the school, its place nor a role, and a mobile are left out, and counted in the
run's message. Phones are written as FR:Key:phone
does: `+33 4 …`, an 08 number national (`08 06 14 15 00`), an overseas one under its own code
(`+262 262 …`); an operator's phone that a spreadsheet stripped of its 0 or its `+` is read
back. A charging site is read from each station's newest declaration (on one day the operator's
or owner's own file before an aggregator's copy, `AGGREGATORS` in `fr/irve-declarations.ts`),
with notes, fee and accessibility read over every
declaration of its points. Declarations sharing a charge point id within 400 m, or its seven-digit
number within 100 m under another operator's prefix, are one site, since operators re-declare a
site under a new station id, position or code. When every single-row station of a site repeats
one count n and there are n of them, n is the site's total.
An address an object already holds as `contact:housenumber|street|postcode|city` (how the
2016–2018 Éducation nationale imports wrote it) is moved to `addr:*` in the mapper's spelling,
as a `del`/`add` pair the reviewer sees, rather than duplicated beside it; a part that differs
from the source leaves the whole address alone. `fee` follows the registry's `gratuit` ("free
with no condition of use", so false is `fee=yes` per the FR wiki) and may overwrite a mapper's
value. Every `mod` of a mapper's value gets a banner line, which also says when a mapper checked
the object in the last twelve months. The **model** extractor sends one record or page per call
(`llm.ts`; OpenAI-compatible `/chat/completions` with a JSON schema, or the Anthropic Messages
API with structured output, both by plain `fetch`) and treats the answer as a witness: a tag
survives only if its quote is really on the page, its key matches the source's allowed
patterns and its confidence clears the floor, which is also capped.

Matching asks Overpass once per area for the source's `matching` selector plus whatever main
tag the records carry (a filter written for `amenity=school` still finds a post-bac `amenity=college`), then
matches by shared ref (`ref:EU:EVSE`, `ref:UAI`, `ref:FR:SIRET`) before distance and name.
Refs compare without `*`, spaces or case, and a `ref:UAI` or SIRET an object holds for another
establishment is never replaced: a banner names both ids. An EVSE id's part after the operator code stands
alone (a pool id surviving a change of operator) only when it holds a letter, and then only
within 150 m: Toulouse's networks all number stations `P<INSEE code><n>`, so a digits-only part
names a different operator's station across town. A ref several records carry (one organisation's
SIRET) decides nothing; an object carrying another `ref:UAI` (or another school's `ce.<UAI>@`
mailbox) is never the match, nor by name or distance is a station carrying only another
operator's EVSE ids. An id on an object that is no longer the place (a `disused:`/`was:` main
tag, a construction site, another main key) settles nothing, and its name or position does not
either. A school building carrying the UAI stays the match over grounds named for a campus
that also hold another establishment. A post-bac school matched to an object that reads as a lycée,
by its `school:FR` or its name, is a section housed in it: its `amenity` is left alone, with a
banner line. An unnamed object matches within
15 m, or within 50 m when its operator, network or brand agrees, and another operator's sign
counts against an object, as does a poor fit of capacity, connectors and power class, or a
connector the record counts that an object listing others lacks; an object two records match
without ids goes to the one that fits it. A charger for bicycles or scooters only (or Schuko
alone) is never a car station's match nor part of its site. The network's own station within
25 m whose connectors fit is matched under a renumbered pool id, with a banner, and up to 150 m
an object whose operator, network, owner or name (without the record's own operator's words)
agrees and whose counts repeat the record's is the station, with the "matched N m away" banner
past 50 m; both distances are to a way's or relation's nearest box edge (Overpass answers
`out bb`). A plain `ref` listing a borne's point ids names those points. A match more than
500 m from both the source's point and the address base's gets none of the address, contacts, SIRET or
`start_date` its kind writes (the banner lists only those) (and nothing at all on an object mapped as no place); one left with nothing to write is counted in the
run's message and listed in the diagnostics bundle. The fetch adds anything carrying a `ref:UAI`, a school's
kin (`college`, `university`), a school mapped only as `building=school|college|university`
(matched by name, the update adding the amenity; never matched unnamed), and a margin
round the box of the farthest reach any matching rule has plus 70 m (`REACH_M` in `match/radii.ts`,
220 m today). Matching cuts candidates by an object's nearest edge, never its centre, since a
car park's centre can lie past the reach while its bays are within it. Lookalikes that must never be matched are fetched for the banner only:
`man_made=charge_point` beside stations, `healthcare=centre` and `amenity=clinic` beside
institutes (and an unnamed school building, as beside schools). The commune's words count for
nothing in a name match, nor do the status words (private, public) or, for a station, the words of what
it is (borne, recharge, station), which are the charging kit's: a school named "Recharge" keeps the word. What matching cannot settle
is not guessed: a "new" POI with an object of its kind within 150 m (300 m when its operator or
address agrees; one without another station's id named first, and the rest of its site within
25 m counted), a match more than 150 m away (naming what of its kind stands within 50 m of the
source's point), a match whose site is mapped as several objects
or whose id another object also carries (one carrying the UAI more than 25 m off is named as
such, not counted into the site), an object of its kind 25–150 m off the match under its name
or the same name spelt a little otherwise, or a groupe scolaire at its address, an object several
records matched (whose counts, and an académie mailbox, are then left out), an object no longer
the place carrying the id a match adds, two "new" records of a run on one spot, SIRET or
address, a school carrying another UAI at the record's address, phone or email, a school within
50 m of a "new" one carrying a UAI the source's whole read does not list, and a point moved to
its address each get a line in the candidate's `warning`, which the review screen shows as a
"Check" banner.
Candidates upsert on `(source_id, source_record_key)`; a record whose `content_hash` is
unchanged is left as the reviewer saw it, and a queued candidate whose OSM object has a newer
version than its base is flagged in conflict instead of being silently recomputed. Resolving
it (the review screen's rebase) reads the object from OSM and the candidate's writes against
it: what the mapper already wrote is dropped, and a candidate with nothing left is removed. A candidate
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
resizing in place) and `m-disclose`/`m-turn` (150ms, a `<details>` opening and its chevron
turning), all disabled under `prefers-reduced-motion`.

**Do not use Svelte `transition:` directives.** An outro holds the node in the DOM until
its animation reports finished, and in a throttled or backgrounded tab that report never
arrives — the overlay is then stuck and the app is unusable. Mount and unmount on state;
where an exit needs to be seen, set a `closing` flag, apply the `-out` class, and drop the
state on a `setTimeout` of the same length. `TopBar`, `BottomNav` and `QueueFilterSheet`
are the worked examples.

**Three layouts, not one**: phone (402), tablet (834), desktop. The queue row, the review
pane and the sources/areas rails each change shape between them, and the evidence gutter
exists only at `lg`. A change to a screen is not done until it has been looked at in all
three.

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
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle |

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
identity-provider, first-admin, pipeline, OSM, LLM and backup values are read. SMTP is the
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
that run outside it (drizzle-kit) get the same files through `loadEnvFiles` in
`src/lib/server/env.ts`. Precedence is shell over `.env.<mode>` over `.env`, and the e2e run
leans on that: `e2e/env.ts` hands the server every variable the suite asserts on, because it
runs without `NODE_ENV` and would otherwise read a developer's `.env.development` — which
names a different admin and switches SSO off. `e2e/sso.spec.ts`
runs a mock provider (`oauth2-mock-server`, in `e2e/idp.ts`) inside the test process, so
each test sets the identity it hands back.

The suite's rows live in `e2e/fixture.ts` and nowhere else: the server boots on an empty
temporary database and bootstraps the admin from `e2e/env.ts`, then `e2e/global-setup.ts`
inserts the two other accounts, two sources, two areas, ten candidates and one failed
changeset that the specs assert on. A spec that needs another row adds it there.

There is no seed and no demo data, in dev or anywhere else. The first account comes from
`bootstrapAdmin` (`src/lib/server/db/bootstrap.ts`): at boot, after migrations, it creates one admin from
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
