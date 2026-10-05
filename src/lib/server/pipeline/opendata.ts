import { type AreaShape, areaBox } from "./geo";
import { DOWNLOAD_TIMEOUT_MS, getJson, ndjson, request } from "./http";
import { type Reader, readerFor } from "./reader";
import { PipelineError, type Row } from "./types";

export interface ApiSource {
	endpoint: string;
	apiKey: string | null;
	extractor: "deterministic" | "model";
	preset: string | null;
}

const PAGE = 100;
/** Opendatasoft refuses `offset + limit` beyond this; past it the whole-dataset export is the way. */
const OFFSET_CEILING = 10_000;

/** `…/datasets/<id>/records?x=y` → `…/datasets/<id>`. */
export function datasetBase(endpoint: string): string {
	return endpoint
		.replace(/[?#].*$/, "")
		.replace(/\/+$/, "")
		.replace(/\/(records|exports(\/\w+)?)$/, "");
}

type Field = { name: string; type: string };

async function datasetFields(base: string, headers: Record<string, string>): Promise<Field[]> {
	try {
		return (await getJson<{ fields?: Field[] }>(base, { headers })).fields ?? [];
	} catch {
		return [];
	}
}

const geoField = (fields: Field[]) =>
	(fields.find((x) => x.type === "geo_point_2d") ?? fields.find((x) => x.type === "geo_shape"))
		?.name ?? "geom";

/**
 * Offset paging over an unordered query may repeat a row and skip another between pages,
 * and a skipped record would be swept as gone. Ordered by the reader's key, a record's rows
 * sit together, so a key is never skipped whole even where rows tie.
 */
function orderField(source: ApiSource, fields: Field[]): string | null {
	const names = fields.map((f) => f.name);
	try {
		const key = readerFor(source, names).keyField;
		return key && names.includes(key) ? key : null;
	} catch {
		return null;
	}
}

/** The ODSQL filter that keeps a query inside the area. */
export function whereClause(field: string, a: AreaShape): string {
	if (a.def === "radius" && a.radius)
		return `within_distance(${field}, geom'POINT(${a.centerLon} ${a.centerLat})', ${a.radius}m)`;
	const [s, w, n, e] = areaBox(a);
	return `in_bbox(${field}, ${s}, ${w}, ${n}, ${e})`;
}

export interface ApiResult {
	rows: Map<string, Row[]>;
	/** Null when the area had no rows to detect a preset from. */
	reader: Reader | null;
	fetched: number;
	skipped: number;
}

/** Records inside one area, keyed by the reader's key. Pages while it can, exports when the area is too big to page. */
export async function readApiArea(source: ApiSource, area: AreaShape): Promise<ApiResult> {
	const headers: Record<string, string> = source.apiKey
		? { authorization: `Apikey ${source.apiKey}` }
		: {};
	const base = datasetBase(source.endpoint);
	const fields = await datasetFields(base, headers);
	const where = whereClause(geoField(fields), area);
	const order = orderField(source, fields);
	const orderBy = order ? `&order_by=${encodeURIComponent(order)}` : "";

	const rows = new Map<string, Row[]>();
	let fetched = 0;
	let skipped = 0;
	let rd: Reader | null = null;
	const take = (row: Row) => {
		fetched += 1;
		rd ??= readerFor(source, Object.keys(row));
		const key = rd.key(row);
		if (!key || !rd.position(row)) {
			skipped += 1;
			return;
		}
		const group = rows.get(key);
		if (group) group.push(row);
		else rows.set(key, [row]);
	};

	for (let offset = 0; ; offset += PAGE) {
		const page = await getJson<{ total_count?: number; results?: Row[] }>(
			`${base}/records?limit=${PAGE}&offset=${offset}${orderBy}&where=${encodeURIComponent(where)}`,
			{ headers },
		);
		if (!Array.isArray(page.results))
			throw new PipelineError("not an Opendatasoft explore v2.1 records endpoint");
		const total = page.total_count ?? page.results.length;
		if (total > OFFSET_CEILING) {
			// The export is the whole answer; what the pages gave so far would be counted twice.
			rows.clear();
			fetched = 0;
			skipped = 0;
			const res = await request(`${base}/exports/jsonl?where=${encodeURIComponent(where)}`, {
				headers,
				timeoutMs: DOWNLOAD_TIMEOUT_MS,
			});
			if (!res.body) throw new PipelineError("the export answered with no body");
			for await (const row of ndjson<Row>(res.body)) take(row);
			break;
		}
		for (const row of page.results) take(row);
		if (page.results.length < PAGE || offset + PAGE >= total) break;
	}
	return { rows, reader: rd, fetched, skipped };
}
