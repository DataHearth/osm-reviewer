import {
	AREAS,
	CANDIDATES,
	HISTORY,
	NOTIFICATIONS,
	RELS,
	SETTINGS,
	SOURCES,
	USERS,
	YIELDS,
} from "../../data";
import { hashPassword } from "../auth/password";
import { seedAdmin } from "../config";
import { loadEnvFiles } from "../env";
import { initialsOf } from "./bootstrap";
import { createDb, type Db } from "./client";
import { runMigrations } from "./migrate";
import * as t from "./schema";

/** Fixture passwords are all this one, and the fixtures carry it in cleartext. */
const FIXTURE_PASSWORD = "review";

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
			t.sourceMetricRows,
			t.sourceConfigRows,
			t.sourceAllowedTags,
			t.areas,
			t.sources,
			t.rels,
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
						osm: u.osm ?? null,
						lastSeen: at(u.lastSeen),
					};
				}),
			)
			.run();

		tx.insert(t.userSettings)
			.values(
				USERS.map((u) => ({ ...SETTINGS, userId: u.id, osmConnected: at(SETTINGS.osmConnected) })),
			)
			.run();

		tx.insert(t.instanceSettings).values(NOTIFICATIONS).run();

		tx.insert(t.sources)
			.values(
				SOURCES.map((s) => ({
					id: s.id,
					name: s.name,
					kind: s.kind,
					kindLabel: s.kindLabel,
					health: s.health,
					failing: s.failing ?? false,
					enabled: s.enabled,
					floor: s.floor,
				})),
			)
			.run();

		for (const s of SOURCES) {
			tx.insert(t.sourceAllowedTags)
				.values(s.allow.map((pattern, position) => ({ sourceId: s.id, position, pattern })))
				.run();
			tx.insert(t.sourceConfigRows)
				.values(
					s.config.map(([label, value, tone], position) => ({
						sourceId: s.id,
						position,
						label,
						value,
						tone: tone ?? null,
					})),
				)
				.run();
			tx.insert(t.sourceMetricRows)
				.values(
					s.metrics.map(([label, value, note, tone], position) => ({
						sourceId: s.id,
						position,
						label,
						value,
						note: note ?? null,
						tone: tone ?? null,
					})),
				)
				.run();
			tx.insert(t.runs)
				.values(
					s.runs.map((r) => ({
						sourceId: s.id,
						startedAt: at(r.when),
						dur: r.dur,
						fetched: r.fetched,
						cands: r.cands,
						errors: r.errors,
						result: r.result,
					})),
				)
				.run();
		}

		tx.insert(t.areas)
			.values(
				AREAS.map((a) => ({
					id: a.id,
					name: a.name,
					def: a.def,
					rel: a.rel ?? null,
					level: a.level ?? null,
					centerLat: a.center[0],
					centerLon: a.center[1],
					km: a.km ?? null,
					radius: a.radius ?? null,
					sqkm: a.sqkm,
					pending: a.pending,
					pois: a.pois,
					accepted30: a.accepted30,
					status: a.status,
					lastRun: a.lastRun,
				})),
			)
			.run();

		tx.insert(t.areaSources)
			.values(
				AREAS.flatMap((a) =>
					a.sources.map((sourceId) => {
						const y = YIELDS[`${sourceId}:${a.id}`];
						return {
							areaId: a.id,
							sourceId,
							candidateCount: y?.[0] ?? null,
							acceptRate: y?.[1] ?? null,
						};
					}),
				),
			)
			.run();

		tx.insert(t.rels)
			.values(
				RELS.map((r) => ({
					rel: r.rel,
					name: r.name,
					meta: r.meta,
					centerLat: r.center[0],
					centerLon: r.center[1],
					km: r.km,
					sqkm: r.sqkm,
					pois: r.pois,
					est: r.est,
				})),
			)
			.run();

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
				})),
			)
			.run();

		for (const c of CANDIDATES) {
			tx.insert(t.candidates)
				.values({
					id: c.id,
					osmId: c.osmId,
					areaId: FIXTURE_AREA,
					sourceId: SOURCE_IDS[c.source] ?? c.source,
					type: c.type,
					name: c.name,
					addr: c.addr,
					lat: c.lat,
					lon: c.lon,
					conf: c.conf,
					version: c.version,
					fetchedAt: at(c.fetched),
					age: c.age,
					stale: c.stale ?? null,
					baseVersion: c.baseVersion ?? null,
					headVersion: c.headVersion ?? null,
					conflictWho: c.conflictWho ?? null,
					unchanged: c.unchanged,
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
