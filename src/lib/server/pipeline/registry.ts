import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { datasetFile } from "./fr/datagouv";
import { type AreaShape, inArea } from "./geo";
import { DOWNLOAD_TIMEOUT_MS, ndjson, request } from "./http";
import { type Reader, readerFor } from "./reader";
import { PipelineError, type Row } from "./types";

export interface RegistrySource {
	endpoint: string;
	apiKey: string | null;
	extractor: "deterministic" | "model";
	preset: string | null;
}

export interface RegistryState {
	url?: string;
	etag?: string;
	/** What the read that stored the ETag depended on besides the file; see `readRegistrySource`. */
	fingerprint?: string;
}

export interface RegistryResult {
	/** Rows per area key, in the file's order; a station's rows end up together. */
	byArea: Map<string, Map<string, Row[]>>;
	reader: Reader | null;
	scanned: number;
	skipped: number;
	/** The server said nothing changed; no rows were read. */
	unchanged: boolean;
	state: RegistryState;
	licence?: string;
	fileUrl: string;
}

const count = (s: string, c: string) => s.split(c).length - 1;

/**
 * csv-parse 7.0.3's `delimiter_auto` keeps a table of the first 127 char codes only and
 * throws on the first accented character, which every French dataset has. The header
 * line decides instead: these files are either comma- or semicolon-separated.
 */
export function sniffDelimiter(head: string): "," | ";" {
	const header = head.split("\n", 1)[0];
	return count(header, ";") > count(header, ",") ? ";" : ",";
}

export async function* csvRows(
	body: ReadableStream<Uint8Array>,
	onSkip: () => void,
): AsyncIterable<Row> {
	const chunks = Readable.fromWeb(body as never)[Symbol.asyncIterator]();
	const first = await chunks.next();
	if (first.done) return;
	const parser = parse({
		columns: true,
		bom: true,
		delimiter: sniffDelimiter(Buffer.from(first.value).toString("utf8")),
		skip_empty_lines: true,
		relax_column_count: true,
		relax_quotes: true,
		skip_records_with_error: true,
		on_skip: () => {
			onSkip();
			return undefined;
		},
	});
	const rest = async function* () {
		yield first.value;
		for (let c = await chunks.next(); !c.done; c = await chunks.next()) yield c.value;
	};
	// pipe() does not forward a source error; without this a timed-out download leaves the parser waiting forever.
	Readable.from(rest())
		.on("error", (err) => parser.destroy(err))
		.pipe(parser);
	yield* parser as AsyncIterable<Row>;
}

/**
 * One streamed pass over the file for every area at once. Only rows inside an area are
 * kept; the 158 MB IRVE file is never in memory, only the stations that matter.
 * `force` drops the conditional request, when the last read cannot stand for this one.
 */
export async function readRegistry(
	source: RegistrySource,
	areas: ({ id: string } & AreaShape)[],
	state: RegistryState,
	force: boolean,
): Promise<RegistryResult> {
	const headers: Record<string, string> = source.apiKey
		? { authorization: `Apikey ${source.apiKey}` }
		: {};
	const file = (await datasetFile(source.endpoint, headers)) ?? { url: source.endpoint };
	const conditional = !force && state.etag && state.url === file.url;
	// The resolved file can live on another host than the endpoint; the key belongs to the endpoint's.
	const fileHeaders = new URL(file.url).host === new URL(source.endpoint).host ? headers : {};
	const res = await request(
		file.url,
		{
			headers: {
				...fileHeaders,
				...(conditional ? { "if-none-match": state.etag as string } : {}),
			},
			timeoutMs: DOWNLOAD_TIMEOUT_MS,
		},
		[304],
	);
	const nextState: RegistryState = { url: file.url, etag: res.headers.get("etag") ?? undefined };

	const empty = {
		scanned: 0,
		skipped: 0,
		state: nextState,
		licence: file.licence,
		fileUrl: file.url,
	};
	if (res.status === 304) {
		return { ...empty, byArea: new Map(), reader: null, unchanged: true, state };
	}
	if (!res.body) throw new PipelineError("the dataset answered with no body");

	let skipped = 0;
	const lines =
		/ndjson|jsonl/i.test(res.headers.get("content-type") ?? "") ||
		/\.(jsonl|ndjson)(\?|$)/.test(file.url);
	const rows = lines
		? ndjson<Row>(res.body)
		: csvRows(res.body, () => {
				skipped += 1;
			});

	const byArea = new Map<string, Map<string, Row[]>>(areas.map((a) => [a.id, new Map()]));
	let reader: Reader | null = null;
	let scanned = 0;
	try {
		for await (const row of rows) {
			reader ??= readerFor(source, Object.keys(row));
			scanned += 1;
			const pos = reader.position(row);
			const key = reader.key(row);
			if (!pos || !key) {
				skipped += 1;
				continue;
			}
			for (const a of areas) {
				if (!inArea(a, pos[0], pos[1])) continue;
				const group = byArea.get(a.id) as Map<string, Row[]>;
				const rowsOfKey = group.get(key);
				if (rowsOfKey) rowsOfKey.push(row);
				else group.set(key, [row]);
			}
		}
	} catch (err) {
		if (err instanceof PipelineError) throw err;
		throw new PipelineError(
			`reading ${new URL(file.url).host}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return {
		byArea,
		reader,
		scanned,
		skipped,
		unchanged: false,
		state: nextState,
		licence: file.licence,
		fileUrl: file.url,
	};
}
