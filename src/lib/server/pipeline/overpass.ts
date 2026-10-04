import { overpass } from "$lib/server/config";
import { type AreaShape, areaBox } from "./geo";
import { request, sleep } from "./http";
import { overpassFilter, type Selector } from "./tagfilter";
import { type OsmElement, PipelineError } from "./types";

export interface OverpassArea extends AreaShape {
	rel: string | null;
}

const REL_AREA_OFFSET = 3_600_000_000;
const QUERY_TIMEOUT_S = 90;

function scope(a: OverpassArea): { head: string; where: string } {
	if (a.def === "radius" && a.radius)
		return { head: "", where: `(around:${a.radius},${a.centerLat},${a.centerLon})` };
	const rel = Number(a.rel);
	if (a.def === "relation" && Number.isInteger(rel) && rel > 0)
		return { head: `area(id:${REL_AREA_OFFSET + rel})->.a;`, where: "(area.a)" };
	const [s, w, n, e] = areaBox(a);
	return { head: "", where: `(${s},${w},${n},${e})` };
}

/**
 * What a candidate is matched against has to cover the same ground its records were cut
 * by, and a relation's records are cut by its box (`inArea`). Fetched with the exact
 * boundary instead, everything in a neighbouring commune's corner of the box finds no OSM
 * object at all and comes out as a new POI, duplicating what is already mapped there.
 */
function matchScope(a: OverpassArea): { head: string; where: string } {
	if (a.def === "radius" || !a.bbox) return scope(a);
	const [s, w, n, e] = a.bbox;
	return { head: "", where: `(${s},${w},${n},${e})` };
}

/**
 * `require` filters are ANDed onto every statement (a crawl wants POIs *with* a website);
 * `selectors` are alternatives. With no selectors the requirement alone picks the elements.
 */
export function buildQuery(a: OverpassArea, selectors: Selector[], require: Selector[] = []) {
	const { head, where } = matchScope(a);
	const and = require.map(overpassFilter).join("");
	const filters = selectors.length ? selectors.map(overpassFilter) : [""];
	const statements = filters.map((f) => `nwr${f}${and}${where};`).join("");
	return `[out:json][timeout:${QUERY_TIMEOUT_S}];${head}(${statements});out center tags meta;`;
}

interface RawElement {
	type: string;
	id: number;
	version?: number;
	user?: string;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
}

export function parseElements(body: { elements?: RawElement[]; remark?: string }): OsmElement[] {
	if (body.remark && /error|timed out/i.test(body.remark))
		throw new PipelineError(`overpass: ${body.remark}`);
	const out: OsmElement[] = [];
	for (const e of body.elements ?? []) {
		if (e.type !== "node" && e.type !== "way" && e.type !== "relation") continue;
		const lat = e.lat ?? e.center?.lat;
		const lon = e.lon ?? e.center?.lon;
		if (lat === undefined || lon === undefined) continue;
		out.push({
			type: e.type,
			id: e.id,
			version: e.version ?? 1,
			user: e.user,
			lat,
			lon,
			tags: e.tags ?? {},
		});
	}
	return out;
}

async function post(query: string) {
	const send = () =>
		request(
			overpass.url,
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: `data=${encodeURIComponent(query)}`,
				timeoutMs: (QUERY_TIMEOUT_S + 30) * 1000,
			},
			[429],
		);
	let res = await send();
	if (res.status === 429) {
		await sleep(15_000);
		res = await send();
	}
	if (!res.ok) throw new PipelineError(`overpass: ${res.status} ${res.statusText}`.trim());
	try {
		return (await res.json()) as { elements?: RawElement[]; remark?: string };
	} catch {
		throw new PipelineError("overpass: answer is not JSON");
	}
}

export async function fetchElements(
	a: OverpassArea,
	selectors: Selector[],
	require: Selector[] = [],
) {
	if (selectors.length === 0 && require.length === 0) return [];
	return parseElements(await post(buildQuery(a, selectors, require)));
}

/** Every POI-ish feature in the area, which is what the area screen calls "POIs watched". */
export async function countPois(a: OverpassArea): Promise<number | null> {
	const { head, where } = scope(a);
	const q = `[out:json][timeout:60];${head}nwr[~"^(amenity|shop|office|tourism|leisure|craft|healthcare)$"~"."]${where};out count;`;
	const body = (await post(q)) as { elements?: { tags?: { total?: string } }[] };
	const total = Number(body.elements?.[0]?.tags?.total);
	return Number.isFinite(total) ? total : null;
}
