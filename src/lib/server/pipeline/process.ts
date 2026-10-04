import { eq } from "drizzle-orm";
import { llm } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import type { SourceRecord } from "$lib/types";
import { checkAddress } from "./ban";
import { refreshConflicts } from "./conflicts";
import { askModel, modelLabel, vetTags } from "./llm";
import {
	closureOps,
	findMatch,
	indexRefs,
	matchWarnings,
	modWarnings,
	nearbyLabels,
	newOps,
	REF_SELECTORS,
	sameValue,
	sharedRefs,
	splitParts,
	type TagOp,
	twinWarnings,
	unchangedTags,
	updateOps,
} from "./match";
import { countPois, fetchElements } from "./overpass";
import { mergeSites, OSM_MAX, str } from "./presets";
import { hash, type Reader } from "./reader";
import { existingCandidates, saveCandidate, sweepVanished, touchSeen } from "./store";
import {
	allowedBy,
	lookalikeSelectors,
	mergeSelectors,
	parseMatching,
	selectorsFromTags,
	selects,
} from "./tagfilter";
import { type Extraction, type OsmElement, osmRef, PipelineError, type RawRecord } from "./types";

export type SourceRow = typeof t.sources.$inferSelect;
export type AreaRow = typeof t.areas.$inferSelect;

export interface AreaInput {
	records: RawRecord[];
	reader: Reader | null;
	/** Crawl already asked Overpass for these; everything else lets this step ask. */
	elements?: OsmElement[];
	/** Whether the source was read to the end, which is what makes an unseen candidate gone rather than unread. */
	complete: boolean;
}

export interface AreaOutcome {
	cands: number;
	errors: string[];
	/** Records whose extraction failed, so a crawl does not remember their pages as read. */
	failedKeys: string[];
}

/** After this many model calls in a row fail the model is down, not the pages odd. */
const MODEL_FAILURES_BEFORE_ABORT = 3;
const POI_RECOUNT_MS = 7 * 24 * 3_600_000;
/** What a source counts for a whole site, which no single part of a split site carries. */
const SITE_COUNTS = /^(capacity|socket:.+)$/;
/** A connector's power is the same whichever record states it; how many there are is not. */
const isCount = (o: TagOp) => SITE_COUNTS.test(o.k) && (o.op === "del" || !o.k.endsWith(":output"));
const SPLIT_COUNTS_NOTE =
	"Capacity and sockets are left out: the source counts the whole site, not this one object";
const SHARED_COUNTS_NOTE =
	"Capacity and sockets are left out: several records were matched to this object, and each counts only its own";

async function extract(
	source: SourceRow,
	rec: RawRecord,
	reader: Reader | null,
	allow: string[],
): Promise<Extraction | null> {
	if (source.extractor === "deterministic")
		return reader?.preset?.extract(rec.rows, rec.url) ?? null;

	const row = rec.rows[0] ?? {};
	const pos: [number, number] | null = rec.element
		? [rec.element.lat, rec.element.lon]
		: (reader?.position(row) ?? null);
	if (!pos) return null;
	const text = rec.text ?? JSON.stringify(row);
	const out = await askModel(llm, { url: rec.url, text, current: rec.element?.tags, allow });
	return {
		key: rec.key,
		url: rec.url,
		name: rec.element?.tags.name || str(row, "nom", "name", "title") || rec.key,
		addr: rec.element?.tags["addr:street"] ?? "",
		lat: pos[0],
		lon: pos[1],
		refs: {},
		tags: vetTags(out, {
			url: rec.url,
			text,
			allow,
			floor: source.floor,
			model: modelLabel() ?? "",
		}),
	};
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A crawled page can be long; the review screen only needs enough of it to check a quote against. */
const RECORD_TEXT_MAX = 100_000;
const recordOf = (rec: RawRecord): SourceRecord =>
	rec.text !== undefined ? { text: rec.text.slice(0, RECORD_TEXT_MAX) } : { rows: rec.rows };

/** One source's records for one area, matched against what OSM has and written as candidates. */
export async function processArea(
	db: Db,
	source: SourceRow,
	area: AreaRow,
	input: AreaInput,
	runStart: Date,
): Promise<AreaOutcome> {
	const allow = db
		.select({ pattern: t.sourceAllowedTags.pattern })
		.from(t.sourceAllowedTags)
		.where(eq(t.sourceAllowedTags.sourceId, source.id))
		.all()
		.map((r) => r.pattern);
	const existing = existingCandidates(db, source.id);
	const errors: string[] = [];
	const failedKeys: string[] = [];
	const unchanged: string[] = [];
	const extracted: { x: Extraction; rec: RawRecord }[] = [];

	let failedInARow = 0;
	for (const rec of mergeSites(input.records, input.reader?.preset)) {
		if (rec.unchanged) {
			unchanged.push(rec.key);
			continue;
		}
		try {
			const raw = await extract(source, rec, input.reader, allow);
			failedInARow = 0;
			if (!raw) continue;
			const x = await checkAddress(raw);
			const tags = x.tags.filter((tag) => allowedBy(allow, tag.k) && tag.conf >= source.floor);
			if (tags.length) extracted.push({ x: { ...x, tags }, rec });
		} catch (err) {
			if (err instanceof PipelineError && /no model configured/.test(err.message)) throw err;
			errors.push(err instanceof Error ? err.message : String(err));
			failedKeys.push(rec.key);
			unchanged.push(rec.key);
			failedInARow += 1;
			if (failedInARow >= MODEL_FAILURES_BEFORE_ABORT && source.extractor === "model")
				throw new PipelineError(`the model keeps failing: ${errors[errors.length - 1]}`);
		}
	}

	const refKeys = [...new Set(extracted.flatMap((e) => Object.keys(e.x.refs)))];
	const selectors = mergeSelectors(
		parseMatching(source.matching),
		selectorsFromTags(extracted.flatMap((e) => e.x.tags)),
		...refKeys.map((k) => REF_SELECTORS[k] ?? []),
	);
	const lookalikes = lookalikeSelectors(extracted.flatMap((e) => e.x.tags));
	const fetched =
		input.elements ?? (await fetchElements(area, mergeSelectors(selectors, lookalikes)));
	// Lookalikes are only for the duplicate banner: never a match, nor part of a site.
	const elements = input.elements
		? fetched
		: fetched.filter((e) => selectors.some((s) => selects(s, e.tags)));

	const refIndex = indexRefs(elements, refKeys);
	const shared = sharedRefs(extracted.map((e) => e.x));
	const matched = extracted.map((e) => ({
		...e,
		el: e.rec.element ?? findMatch(e.x, elements, refIndex, shared),
	}));
	const byElement = new Map<string, Extraction[]>();
	for (const { x, el } of matched)
		if (el) byElement.set(osmRef(el), [...(byElement.get(osmRef(el)) ?? []), x]);
	const twins = twinWarnings(matched.filter((m) => !m.el && !m.x.closedBy).map((m) => m.x));

	let cands = 0;
	for (const { x, rec, el } of matched) {
		let type: "new" | "update" | "closure";
		let ops: TagOp[];
		const notes: string[] = [];
		const osmId = el ? osmRef(el) : null;
		const others = osmId ? (byElement.get(osmId) ?? []).filter((o) => o.key !== x.key) : [];
		if (x.closedBy) {
			if (!el) continue;
			type = "closure";
			ops = closureOps(x.closedBy, el.tags, 0.8);
		} else if (el) {
			type = "update";
			ops = updateOps(x.tags, el.tags);
			const split = splitParts(x, el, fetched, refIndex, shared).length > 0;
			const counts = split
				? ops.filter((o) => SITE_COUNTS.test(o.k))
				: others.length
					? ops.filter(isCount)
					: [];
			if (counts.length) {
				ops = ops.filter((o) => !counts.includes(o));
				notes.push(split ? SPLIT_COUNTS_NOTE : SHARED_COUNTS_NOTE);
			}
			// Several establishments on one object (a cité scolaire) each propose their own phone,
			// SIRET or UAI for it; whichever a reviewer accepted last would win.
			const disputed = ops.filter((o) =>
				others.some((other) => other.tags.some((t) => t.k === o.k && !sameValue(o.k, t.v, o.v))),
			);
			if (disputed.length) {
				ops = ops.filter((o) => !disputed.includes(o));
				notes.push(
					`Left out, since another record on this object says otherwise: ${disputed.map((o) => o.k).join(", ")}`,
				);
			}
			notes.push(...modWarnings(ops, el.tags));
		} else {
			type = "new";
			ops = newOps(x.tags);
		}
		if (ops.length === 0) continue;
		for (const o of ops)
			if (o.v.length > OSM_MAX) o.invalid = `${o.v.length} characters, over OSM's ${OSM_MAX}`;

		// What the source proposes, not the rows it was read from: a fixed preset or a new
		// model answer has to reach an undecided candidate as surely as a change in the data.
		// The operations it makes against OSM are hashed apart: a fix to matching must reach
		// the candidate too, but only while the element is where it was, since an element
		// that moved is a conflict to flag, not a candidate to rebase quietly. What an accept
		// is checked against (the groups, the object's other tags) goes with the operations.
		const proposal = hash(
			JSON.stringify([x.name, x.addr, x.lat, x.lon, x.tags, x.closedBy ?? null]),
		);
		const kept = el ? unchangedTags(el.tags, new Set(ops.map((o) => o.k))) : [];
		const written = ops.map((o) => [o.op, o.k, o.v, o.was, o.group ?? null, o.pair ?? null]);
		const h = `${proposal}:${hash(JSON.stringify([written, kept]))}`;
		const had = existing.get(x.key);
		const moved = !!had && !!el && had.osmId === osmRef(el) && had.version !== el.version;
		const same = had?.contentHash === h || (moved && had?.contentHash?.split(":")[0] === proposal);
		const warning =
			[
				...(x.notes ?? []),
				...notes,
				...(el ? (x.absent ?? []).filter((k) => el.tags[k] !== undefined) : []).map(
					(k) => `OSM has ${k}=${el?.tags[k]}, which the source says this place does not have`,
				),
				...matchWarnings(x, el, fetched, refIndex, shared),
				...(twins.get(x.key) ?? []),
				...others.map(
					(o) => `Also matched by “${o.name}” (${o.key}), another candidate on this object`,
				),
			].join("\n") || null;
		if (
			had &&
			!had.decided &&
			had.areaId === area.id &&
			same &&
			had.osmId === osmId &&
			had.warning === warning
		) {
			if (!had.hasRecord)
				db.update(t.candidates)
					.set({ record: recordOf(rec) })
					.where(eq(t.candidates.id, had.id))
					.run();
			unchanged.push(x.key);
			continue;
		}

		const wrote = saveCandidate(
			db,
			{
				sourceId: source.id,
				areaId: area.id,
				key: x.key,
				hash: h,
				type,
				osmId,
				version: el?.version ?? 0,
				name: x.name,
				addr: x.addr,
				lat: x.lat,
				lon: x.lon,
				conf: round2(ops.reduce((n, o) => n + o.conf, 0) / ops.length),
				url: x.url,
				licence: source.licence,
				ops,
				nearby: nearbyLabels(x, elements, el),
				unchanged: kept,
				record: recordOf(rec),
				warning,
				seenAt: new Date(),
			},
			had,
		);
		if (wrote) cands += 1;
	}

	if (unchanged.length) touchSeen(db, source.id, area.id, unchanged, new Date());
	refreshConflicts(db, area.id, elements);
	if (input.complete) sweepVanished(db, source.id, area.id, runStart);

	let pois = area.pois;
	if (
		area.pois === null ||
		!area.lastRunAt ||
		Date.now() - area.lastRunAt.getTime() > POI_RECOUNT_MS
	) {
		try {
			pois = (await countPois(area)) ?? area.pois;
		} catch {
			// the count is decoration; a busy Overpass must not fail the run
		}
	}
	db.update(t.areas).set({ lastRunAt: new Date(), pois }).where(eq(t.areas.id, area.id)).run();

	return { cands, errors, failedKeys };
}
