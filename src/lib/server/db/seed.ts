import { CANDIDATES, HISTORY, NOTIFICATIONS, SETTINGS, USERS } from "../../data";
import { hashPassword } from "../auth/password";
import { seedAdmin } from "../config";
import { loadEnvFiles } from "../env";
import { initialsOf } from "./bootstrap";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";
import * as t from "./schema";

/** Fixture passwords are all this one, and the fixtures carry it in cleartext. */
const FIXTURE_PASSWORD = "review";

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface SeedSource {
	id: string;
	name: string;
	kind: "registry" | "crawl" | "api";
	health: "ok" | "warn" | "error";
	failing?: boolean;
	enabled?: boolean;
	floor: number;
	endpoint: string;
	apiKey?: string;
	schedule: "every 12 h" | "daily" | "weekly" | "monthly";
	matching?: string;
	budget?: string;
	extractor?: "deterministic" | "model";
	preset?: string;
	licence?: string;
	allow: string[];
	/** Hours until the next run; absent means due at the first scheduler tick. */
	nextInHours?: number;
	/** [started DD-MM-YYYY HH:MM, minutes, fetched, cands, errors, result, message] */
	runs?: [string, number, number, number, number, "ok" | "partial" | "failed", string?][];
}

/**
 * The four older sources carry the fixture candidates and history; they are scheduled a
 * day out so a dev server does not fire them at boot. The last two are real datasets and
 * have never run, which is what makes the first scheduler tick do something.
 */
const SOURCES: SeedSource[] = [
	{
		id: "sirene",
		name: "SIRENE — établissements",
		kind: "registry",
		health: "ok",
		floor: 0.6,
		endpoint: "https://files.data.gouv.fr/insee-sirene/StockEtablissement_utf8.zip",
		schedule: "monthly",
		matching: "SIRET ↔ ref:FR:SIRET, then name + addr fuzzy ≥0.88",
		licence: "Licence Ouverte 2.0",
		allow: ["amenity", "shop", "office", "craft", "name", "addr:*", "ref:FR:SIRET", "disused:*"],
		nextInHours: 24,
		runs: [
			["01-09-2026 04:12", 41, 34_200_000, 186, 0, "ok"],
			["01-08-2026 04:09", 38, 34_100_000, 204, 0, "ok"],
			["01-07-2026 04:11", 44, 34_000_000, 171, 2, "ok", "2 rows skipped"],
			["01-06-2026 04:08", 39, 33_900_000, 233, 0, "ok"],
		],
	},
	{
		id: "web",
		name: "Operator website crawl",
		kind: "crawl",
		health: "warn",
		floor: 0.55,
		endpoint: "website=* on POIs inside the area",
		schedule: "every 12 h",
		budget: "400 pages / run · 1 request / 4 s per host",
		extractor: "model",
		allow: ["opening_hours", "phone", "website", "email", "takeaway", "delivery", "wheelchair"],
		nextInHours: 12,
		runs: [
			["14-09-2026 06:12", 8, 392, 38, 14, "partial", "14 fetch failures"],
			["13-09-2026 18:12", 9, 400, 44, 6, "ok"],
			["13-09-2026 06:12", 7, 361, 29, 9, "ok"],
			["12-09-2026 18:12", 8, 388, 41, 5, "ok"],
		],
	},
	{
		id: "datatls",
		name: "data.toulouse-metropole.fr",
		kind: "api",
		health: "ok",
		floor: 0.7,
		endpoint:
			"https://data.toulouse-metropole.fr/api/explore/v2.1/catalog/datasets/commerces/records",
		apiKey: "fixture-key-3f71",
		schedule: "weekly",
		licence: "ODbL",
		allow: ["amenity", "shop", "name", "addr:*", "opening_hours", "operator"],
		nextInHours: 48,
		runs: [
			["08-09-2026 05:00", 2, 3742, 19, 0, "ok"],
			["01-09-2026 05:00", 2, 3740, 24, 0, "ok"],
			["25-08-2026 05:01", 3, 3731, 31, 1, "ok", "1 row malformed"],
			["18-08-2026 05:00", 2, 3728, 12, 0, "ok"],
		],
	},
	{
		id: "datagouv",
		name: "data.gouv.fr — annuaire",
		kind: "api",
		health: "error",
		failing: true,
		enabled: false,
		floor: 0.75,
		endpoint: "https://www.data.gouv.fr/api/1/datasets/annuaire-administration/",
		apiKey: "fixture-key-d9e2",
		schedule: "weekly",
		allow: ["amenity", "name", "operator", "ref:FR:*", "opening_hours"],
		runs: [
			["10-09-2026 05:00", 0, 0, 0, 1, "failed", "401 unauthorized"],
			["03-09-2026 05:00", 0, 0, 0, 1, "failed", "401 unauthorized"],
			["27-08-2026 05:00", 0, 0, 0, 1, "failed", "401 unauthorized"],
			["20-08-2026 05:00", 1, 1880, 7, 0, "ok"],
		],
	},
	{
		id: "irve",
		name: "IRVE — bornes de recharge",
		kind: "registry",
		health: "ok",
		floor: 0.7,
		endpoint:
			"https://www.data.gouv.fr/api/1/datasets/fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques/",
		schedule: "weekly",
		matching: "amenity=charging_station",
		preset: "irve",
		licence: "Licence Ouverte 1.0",
		allow: [
			"amenity",
			"name",
			"operator",
			"capacity",
			"socket:*",
			"authentication:*",
			"network",
			"fee",
			"access",
			"opening_hours",
			"ref:EU:EVSE",
		],
	},
	{
		id: "education",
		name: "Annuaire de l'éducation",
		kind: "api",
		health: "ok",
		floor: 0.7,
		endpoint:
			"https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records",
		schedule: "weekly",
		matching: "amenity=school",
		preset: "annuaire-education",
		licence: "Licence Ouverte 2.0",
		allow: [
			"amenity",
			"name",
			"operator:type",
			"ref:UAI",
			"ref:FR:SIRET",
			"addr:*",
			"phone",
			"website",
			"isced:level",
		],
	},
];

interface SeedArea {
	id: string;
	name: string;
	def: "relation" | "radius";
	rel?: string;
	level?: number;
	displayName?: string;
	bbox?: [number, number, number, number];
	center: [number, number];
	km?: number;
	radius?: number;
	sqkm: number;
	pois?: number;
	paused?: boolean;
	lastRun?: string;
	sources: string[];
}

const AREAS: SeedArea[] = [
	{
		id: "tls",
		name: "Toulouse",
		def: "relation",
		rel: "35738",
		level: 8,
		displayName: "Toulouse, Haute-Garonne, Occitanie, France",
		center: [43.6045, 1.444],
		km: 8.6,
		sqkm: 118,
		pois: 18402,
		lastRun: "14-09-2026 06:12",
		sources: ["sirene", "web", "datatls", "datagouv"],
	},
	{
		id: "bdx",
		name: "Bordeaux",
		def: "relation",
		rel: "75689",
		level: 8,
		displayName: "Bordeaux, Gironde, Nouvelle-Aquitaine, France",
		center: [44.8378, -0.5792],
		km: 7.2,
		sqkm: 49,
		pois: 11970,
		lastRun: "14-09-2026 05:40",
		sources: ["sirene", "web", "datagouv"],
	},
	{
		id: "mpl",
		name: "Montpellier centre",
		def: "radius",
		center: [43.6109, 3.8767],
		radius: 2500,
		sqkm: 20,
		pois: 3318,
		paused: true,
		lastRun: "30-08-2026 05:10",
		sources: ["sirene"],
	},
	{
		id: "alb",
		name: "Albi",
		def: "relation",
		rel: "103574",
		level: 8,
		displayName: "Albi, Tarn, Occitanie, France",
		center: [43.9289, 2.148],
		km: 4.6,
		sqkm: 44,
		sources: ["sirene", "web"],
	},
	{
		id: "lyo",
		name: "Lyon",
		def: "relation",
		rel: "120965",
		level: 8,
		displayName: "Lyon, Métropole de Lyon, Rhône, Auvergne-Rhône-Alpes, France",
		bbox: [45.7073666, 4.7718489, 45.8082628, 4.8983774],
		center: [45.764, 4.8357],
		km: 5.4,
		sqkm: 48,
		sources: ["irve", "education"],
	},
];

/** The candidate fixtures name the crawl source "website"; the source itself is "web". */
const SOURCE_IDS: Record<string, string> = { website: "web" };

/** Every fixture candidate sits in Toulouse; the fixtures never say so explicitly. */
const FIXTURE_AREA = "tls";

/**
 * Fixtures spell dates DD-MM-YYYY, optionally followed by HH:MM. They are built in
 * the instance's own zone, because that is the zone every screen formats them back
 * in — build them as UTC and a fixture reads back an hour or two off its own text.
 */
function at(value: string): Date {
	const m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(value);
	if (!m) throw new Error(`unparseable fixture date: ${value}`);
	return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
}

/** An SSO-only fixture has no password to override, so the environment cannot adopt one. */
const overridden = (u: (typeof USERS)[number]) => u.role === "admin" && !u.ssoOnly;

async function seed(db: Db): Promise<void> {
	const passwordHash = await hashPassword(FIXTURE_PASSWORD);
	const adminHash = seedAdmin.password ? await hashPassword(seedAdmin.password) : passwordHash;

	db.transaction((tx) => {
		for (const table of [
			t.decisionTags,
			t.decisions,
			t.evidenceParts,
			t.evidence,
			t.tags,
			t.candidateNearby,
			t.candidateConflictTags,
			t.candidates,
			t.areaSources,
			t.runs,
			t.sourceAllowedTags,
			t.areas,
			t.sources,
			t.changesets,
			t.sessions,
			t.userSettings,
			t.instanceSettings,
			t.users,
		]) {
			tx.delete(table).run();
		}

		tx.insert(t.users)
			.values(
				USERS.map((u) => {
					const name = (overridden(u) && seedAdmin.name) || u.name;
					return {
						id: u.id,
						name,
						email: (overridden(u) && seedAdmin.email) || u.email,
						role: u.role,
						initials: name === u.name ? u.initials : initialsOf(name),
						passwordHash: u.ssoOnly ? null : overridden(u) ? adminHash : passwordHash,
						lastSeen: at(u.lastSeen),
					};
				}),
			)
			.run();

		tx.insert(t.userSettings)
			.values(
				USERS.map((u) => ({
					...SETTINGS,
					userId: u.id,
					osmConnected: at(SETTINGS.osmConnected),
					osmUserName: u.osm ?? null,
				})),
			)
			.run();

		tx.insert(t.instanceSettings).values(NOTIFICATIONS).run();

		const now = Date.now();
		for (const src of SOURCES) {
			const { allow, runs, nextInHours, ...row } = src;
			tx.insert(t.sources)
				.values({
					...row,
					apiKey: row.apiKey ?? null,
					preset: row.preset ?? null,
					nextRunAt: nextInHours === undefined ? null : new Date(now + nextInHours * HOUR),
				})
				.run();
			tx.insert(t.sourceAllowedTags)
				.values(allow.map((pattern, position) => ({ sourceId: src.id, position, pattern })))
				.run();
			if (runs) {
				tx.insert(t.runs)
					.values(
						runs.map(([when, minutes, fetched, cands, errors, result, message]) => ({
							sourceId: src.id,
							startedAt: at(when),
							durMs: minutes * 60_000,
							fetched,
							cands,
							errors,
							result,
							message: message ?? null,
						})),
					)
					.run();
			}
		}

		for (const a of AREAS) {
			const { sources: linked, lastRun, bbox, pois, center, ...row } = a;
			tx.insert(t.areas)
				.values({
					...row,
					rel: row.rel ?? null,
					level: row.level ?? null,
					displayName: row.displayName ?? null,
					km: row.km ?? null,
					radius: row.radius ?? null,
					centerLat: center[0],
					centerLon: center[1],
					bbox: bbox ?? null,
					pois: pois ?? null,
					paused: a.paused ?? false,
					lastRunAt: lastRun ? at(lastRun) : null,
				})
				.run();
			tx.insert(t.areaSources)
				.values(linked.map((sourceId) => ({ areaId: a.id, sourceId })))
				.run();
		}

		tx.insert(t.changesets)
			.values(
				HISTORY.map((h) => ({
					id: h.url.slice(h.url.lastIndexOf("/") + 1),
					osmId: h.id === "—" ? null : h.id,
					url: h.url,
					uploadedAt: at(h.when),
					comment: h.comment,
					objects: h.objects,
					result: h.result,
					error:
						h.id === "—" ? "409 Conflict — an object moved while the changeset was open" : null,
					uploadedBy: "u1",
				})),
			)
			.run();

		for (const c of CANDIDATES) {
			tx.insert(t.candidates)
				.values({
					id: c.id,
					osmId: c.osmId,
					sourceRecordKey: c.id,
					areaId: FIXTURE_AREA,
					sourceId: SOURCE_IDS[c.source] ?? c.source,
					type: c.type,
					name: c.name,
					addr: c.addr,
					lat: c.lat,
					lon: c.lon,
					conf: c.conf,
					version: c.version,
					fetchedAt: new Date(now - (Number.parseInt(c.age, 10) || 0) * DAY),
					baseVersion: c.baseVersion ?? null,
					headVersion: c.headVersion ?? null,
					conflictWho: c.conflictWho ?? null,
					unchangedTags: c.unchanged,
				})
				.run();

			tx.insert(t.candidateNearby)
				.values(c.nearby.map((label, position) => ({ candidateId: c.id, position, label })))
				.run();

			const conflictTags = (["theirs", "ours"] as const).flatMap((side) =>
				(c[side] ?? []).map((tag, position) => ({ candidateId: c.id, side, position, ...tag })),
			);
			if (conflictTags.length > 0) tx.insert(t.candidateConflictTags).values(conflictTags).run();

			for (const [position, tag] of c.tags.entries()) {
				const [{ id: tagId }] = tx
					.insert(t.tags)
					.values({
						candidateId: c.id,
						position,
						op: tag.op,
						k: tag.k,
						v: tag.v,
						was: tag.was ?? null,
						conf: tag.conf,
						invalid: tag.invalid ?? false,
						invalidMsg: tag.invalidMsg ?? null,
						invalidHint: tag.invalidHint ?? null,
					})
					.returning({ id: t.tags.id })
					.all();

				if (!tag.ev) continue;
				const [{ id: evidenceId }] = tx
					.insert(t.evidence)
					.values({
						tagId,
						path: tag.ev.path,
						url: tag.ev.url,
						when: tag.ev.when,
						kind: tag.ev.kind,
						conf: tag.ev.conf,
					})
					.returning({ id: t.evidence.id })
					.all();

				tx.insert(t.evidenceParts)
					.values(
						tag.ev.parts.map((part, partPosition) => ({
							evidenceId,
							position: partPosition,
							text: part.text,
							mark: part.mark,
						})),
					)
					.run();
			}
		}
	});
}

loadEnvFiles();
const db = createDb(process.env.DATABASE_PATH);
runMigrations(db);
await seed(db);
console.log("seeded");
