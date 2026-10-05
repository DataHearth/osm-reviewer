export interface OsmElement {
	type: "node" | "way" | "relation";
	id: number;
	version: number;
	user?: string;
	lat?: number;
	lon?: number;
	tags: Record<string, string>;
	nodes?: number[];
	members?: { type: string; ref: number; role: string }[];
}

export interface TagOp {
	op: "add" | "mod" | "del";
	k: string;
	v: string;
}

export type Change =
	| { kind: "modify"; element: OsmElement; ops: TagOp[]; closure: boolean }
	| { kind: "create"; placeholder: number; lat: number; lon: number; ops: TagOp[] };

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
	"\n": "&#10;",
	"\r": "&#13;",
	"\t": "&#9;",
};

/**
 * What XML 1.0 cannot carry at all, raw or as a character reference: OSM refuses the whole
 * upload over one of them. Under `u`, `\p{Cs}` matches a lone surrogate and never half a pair.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: these are the characters being removed
const NOT_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|\p{Cs}/gu;

export const esc = (s: string) =>
	s.replace(NOT_XML, "").replace(/[&<>"'\n\r\t]/g, (c) => ESCAPES[c]);

/**
 * Applied to the object's current tags, never to a copy fetched earlier, so a tag
 * someone else added between fetch and upload survives. A closure candidate carries
 * its lifecycle tag as a `disused:` key (`disused:amenity=pharmacy`); the bare key it
 * replaces is dropped too, or the object would stay a live pharmacy beside the new tag.
 */
export function applyOps(
	current: Record<string, string>,
	ops: TagOp[],
	closure: boolean,
): Record<string, string> {
	const tags = { ...current };
	for (const { op, k, v } of ops) {
		if (op === "del") {
			delete tags[k];
			continue;
		}
		tags[k] = v;
		if (closure && k.startsWith("disused:")) delete tags[k.slice("disused:".length)];
	}
	return tags;
}

const tagXml = (tags: Record<string, string>) =>
	Object.entries(tags)
		.map(([k, v]) => `    <tag k="${esc(k)}" v="${esc(v)}"/>\n`)
		.join("");

function modifyXml(c: Extract<Change, { kind: "modify" }>, changeset: string) {
	const e = c.element;
	const attrs =
		`id="${e.id}" version="${e.version}" changeset="${esc(changeset)}"` +
		(e.type === "node" ? ` lat="${e.lat}" lon="${e.lon}"` : "");
	const children =
		(e.nodes ?? []).map((n) => `    <nd ref="${n}"/>\n`).join("") +
		(e.members ?? [])
			.map((m) => `    <member type="${esc(m.type)}" ref="${m.ref}" role="${esc(m.role)}"/>\n`)
			.join("") +
		tagXml(applyOps(e.tags, c.ops, c.closure));
	return `  <${e.type} ${attrs}>\n${children}  </${e.type}>\n`;
}

function createXml(c: Extract<Change, { kind: "create" }>, changeset: string) {
	return (
		`  <node id="${c.placeholder}" version="1" changeset="${esc(changeset)}" lat="${c.lat}" lon="${c.lon}">\n` +
		tagXml(applyOps({}, c.ops, false)) +
		"  </node>\n"
	);
}

export function osmChange(changes: Change[], changeset: string, generator: string): string {
	const block = (name: string, body: string) => (body ? `<${name}>\n${body}</${name}>\n` : "");
	const creates = changes.flatMap((c) => (c.kind === "create" ? [createXml(c, changeset)] : []));
	const modifies = changes.flatMap((c) => (c.kind === "modify" ? [modifyXml(c, changeset)] : []));
	return (
		`<osmChange version="0.6" generator="${esc(generator)}">\n` +
		block("create", creates.join("")) +
		block("modify", modifies.join("")) +
		"</osmChange>\n"
	);
}

export function changesetXml(tags: Record<string, string>, generator: string): string {
	return `<osm>\n  <changeset>\n${tagXml({ ...tags, created_by: generator })}  </changeset>\n</osm>\n`;
}
