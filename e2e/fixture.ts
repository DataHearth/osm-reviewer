import { hashPassword } from "../src/lib/server/auth/password";
import { createDb } from "../src/lib/server/db/client";
import * as t from "../src/lib/server/db/schema";
import { LOCKOUT_VICTIM, PASSWORD, SSO_ONLY } from "./helpers";

const DAY = 86_400_000;

/** A tag the candidate proposes: its quote marks the matched span with `|`, null is unevidenced. */
type FixtureTag = [k: string, v: string, quote: string | null, invalid?: true];

interface FixtureCandidate {
	id: string;
	name: string;
	type: "new" | "update" | "closure";
	conf: number;
	ageDays: number;
	tags: FixtureTag[];
	conflict?: true;
}

/**
 * Ten candidates in Toulouse, one per thing the queue specs look for: the two new POIs
 * sort first, the closures make a filter of two, and each flag appears exactly once.
 */
export const CANDIDATES: FixtureCandidate[] = [
	{
		id: "c8",
		name: "Fleuriste des Minimes",
		type: "new",
		conf: 0.95,
		ageDays: 2,
		tags: [
			["shop", "florist", "activité: |commerce de détail de fleurs| (47.76Z)"],
			["name", "Fleuriste des Minimes", "enseigne1Etablissement: |FLEURISTE DES MINIMES|"],
		],
	},
	{
		id: "c2",
		name: "Café Sept",
		type: "new",
		conf: 0.93,
		ageDays: 5,
		tags: [["amenity", "cafe", "activité: |débits de boissons|"]],
	},
	{
		id: "c5",
		name: "Le Bibent",
		type: "update",
		conf: 0.9,
		ageDays: 4,
		tags: [["opening_hours", "Mo-Su 08:00-02:00", "horaires: |8h–2h|"]],
		conflict: true,
	},
	{
		id: "c3",
		name: "Ombres Blanches",
		type: "update",
		conf: 0.88,
		ageDays: 3,
		tags: [["phone", "05 61 21 44 94", "tél: |05 61 21 44 94|", true]],
	},
	{
		id: "c9",
		name: "Tabac des Carmes",
		type: "update",
		conf: 0.88,
		ageDays: 1,
		tags: [["shop", "tobacco", "activité: |tabac|"]],
	},
	{
		id: "c1",
		name: "Boulangerie Gaubert",
		type: "update",
		conf: 0.81,
		ageDays: 12,
		tags: [
			["shop", "bakery", "activité: |boulangerie|"],
			["takeaway", "yes", null],
		],
	},
	{
		id: "c6",
		name: "Boucherie Cazes",
		type: "update",
		conf: 0.76,
		ageDays: 92,
		tags: [["shop", "butcher", "activité: |boucherie|"]],
	},
	{
		id: "c4",
		name: "Pharmacie du Capitole",
		type: "closure",
		conf: 0.71,
		ageDays: 7,
		tags: [["disused:amenity", "pharmacy", "état: |fermé|"]],
	},
	{
		id: "c10",
		name: "Coiffure Saint-Cyprien",
		type: "closure",
		conf: 0.62,
		ageDays: 9,
		tags: [["disused:shop", "hairdresser", "état: |fermé|"]],
	},
	{
		id: "c7",
		name: "Épicerie Compans",
		type: "update",
		conf: 0.38,
		ageDays: 6,
		tags: [
			["opening_hours", "Mo-Su 08:00-22:00", null],
			["phone", "+33 5 61 48 12 90", null],
		],
	},
];

export const SOURCE_COUNT = 2;
export const FAILED_CHANGESET = {
	id: "e2e-failed",
	comment: "Closures from SIRENE cessations",
	error: "409 Conflict — an object moved while the changeset was open",
};

/**
 * The rows the suite asserts on, added beside the admin that `bootstrapAdmin` created
 * when the server booted on the empty database.
 */
export async function insertFixture(path: string) {
	const db = createDb(path);
	const passwordHash = await hashPassword(PASSWORD);
	const now = Date.now();

	db.transaction((tx) => {
		tx.insert(t.users)
			.values([
				{
					id: "reviewer",
					name: "Camille Roux",
					email: LOCKOUT_VICTIM.email,
					role: "reviewer",
					initials: "CR",
					passwordHash,
				},
				{
					id: "sso-only",
					name: "Théo Marchand",
					email: SSO_ONLY.email,
					role: "reviewer",
					initials: "TM",
					passwordHash: null,
				},
			])
			.run();

		tx.insert(t.instanceSettings)
			.values({
				id: 1,
				ntfyOn: true,
				ntfyServer: "https://ntfy.test",
				ntfyTopic: "osm-review",
				emailOn: true,
				emailTo: "ops@example.test",
				emailRelay: "smtp.test:587",
			})
			.run();

		tx.insert(t.sources)
			.values([
				{
					id: "sirene",
					name: "SIRENE — établissements",
					kind: "registry",
					health: "ok",
					floor: 0.6,
					licence: "Licence Ouverte 2.0",
				},
				{ id: "web", name: "Operator website crawl", kind: "crawl", health: "ok", floor: 0.55 },
			])
			.run();

		tx.insert(t.areas)
			.values([
				{
					id: "tls",
					name: "Toulouse",
					def: "relation",
					rel: "35738",
					level: 8,
					centerLat: 43.6045,
					centerLon: 1.444,
					sqkm: 118,
				},
				{
					id: "bdx",
					name: "Bordeaux",
					def: "relation",
					rel: "75689",
					level: 8,
					centerLat: 44.8378,
					centerLon: -0.5792,
					sqkm: 49,
				},
			])
			.run();
		tx.insert(t.areaSources)
			.values([
				{ areaId: "tls", sourceId: "sirene" },
				{ areaId: "bdx", sourceId: "sirene" },
			])
			.run();

		tx.insert(t.changesets)
			.values({
				...FAILED_CHANGESET,
				osmId: null,
				url: "",
				uploadedAt: new Date(now - DAY),
				objects: "2 nodes",
				result: "409",
			})
			.run();

		for (const [i, c] of CANDIDATES.entries()) {
			tx.insert(t.candidates)
				.values({
					id: c.id,
					osmId: c.type === "new" ? null : `node/${1000 + i}`,
					sourceRecordKey: c.id,
					areaId: "tls",
					sourceId: "sirene",
					type: c.type,
					name: c.name,
					addr: "Toulouse",
					lat: 43.6 + i / 1000,
					lon: 1.44,
					conf: c.conf,
					version: c.type === "new" ? 0 : 3,
					fetchedAt: new Date(now - c.ageDays * DAY),
					baseVersion: c.conflict ? 3 : null,
					headVersion: c.conflict ? 4 : null,
				})
				.run();

			for (const [position, [k, v, quote, invalid]] of c.tags.entries()) {
				const [{ id: tagId }] = tx
					.insert(t.tags)
					.values({ candidateId: c.id, position, op: "add", k, v, conf: c.conf, invalid })
					.returning({ id: t.tags.id })
					.all();
				if (!quote) continue;
				const [{ id: evidenceId }] = tx
					.insert(t.evidence)
					.values({
						tagId,
						path: `sirene:${c.id}`,
						url: "https://example.invalid/sirene",
						when: `${c.ageDays}d ago`,
						kind: "dataset row",
						conf: c.conf,
					})
					.returning({ id: t.evidence.id })
					.all();
				tx.insert(t.evidenceParts)
					.values(
						quote
							.split("|")
							.map((text, part) => ({ evidenceId, position: part, text, mark: part % 2 === 1 })),
					)
					.run();
			}
		}
	});
}
