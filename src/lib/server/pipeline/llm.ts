import OpeningHours from "opening_hours";
import { z } from "zod";
import { OSM_MAX } from "$lib/changeset";
import { llm } from "$lib/server/config";
import { PHONE_FORMAT } from "./fr/text";
import { request } from "./http";
import { allowedBy } from "./tagfilter";
import { PipelineError, type ProposedTag } from "./types";

export interface ModelConfig {
	provider: "openai" | "anthropic" | null;
	url: string | undefined;
	model: string | undefined;
	apiKey: string | undefined;
}

export const modelLabel = (c: ModelConfig = llm) =>
	c.provider && c.model ? `${c.provider} · ${c.model}` : null;

const OUTPUT = z.object({
	tags: z.array(
		z.object({
			k: z.string(),
			v: z.string(),
			confidence: z.number(),
			quote: z.string(),
		}),
	),
});
export type ModelOutput = z.infer<typeof OUTPUT>;

const SCHEMA = {
	type: "object",
	properties: {
		tags: {
			type: "array",
			items: {
				type: "object",
				properties: {
					k: { type: "string" },
					v: { type: "string" },
					confidence: { type: "number" },
					quote: { type: "string" },
				},
				required: ["k", "v", "confidence", "quote"],
				additionalProperties: false,
			},
		},
	},
	required: ["tags"],
	additionalProperties: false,
} as const;

const SYSTEM = [
	"You propose OpenStreetMap tags for one place from the text of a source about it.",
	"Only propose a tag the text states outright; never infer, never guess, never use outside knowledge.",
	"For every tag give a confidence between 0 and 1 and `quote`: the exact words from the text you relied on, copied character for character.",
	`Use OSM tag keys and OSM value conventions (opening_hours syntax with English day abbreviations and PH off for public holidays, ${PHONE_FORMAT}, lowercase yes/no).`,
	"Never derive one tag from another: no website from an email domain, no brand from the name — brand is only a chain or franchise.",
	"A phone number or website belongs to the place itself, not to a head office, a web designer or a neighbouring business.",
	"If the text says nothing useful, return no tags.",
].join(" ");

export interface PageInput {
	url: string;
	text: string;
	/** What OSM already says about the place, so the model proposes differences rather than repeats. */
	current?: Record<string, string>;
	allow: string[];
}

function userMessage(p: PageInput) {
	const known =
		p.current && Object.keys(p.current).length
			? `Current OSM tags: ${JSON.stringify(p.current)}\n\n`
			: "";
	const keys = p.allow.length ? `Allowed tag keys: ${p.allow.join(", ")}\n\n` : "";
	return `${known}${keys}Source ${p.url}\n\n<text>\n${p.text}\n</text>`;
}

export function buildRequest(c: ModelConfig, p: PageInput): { url: string; init: RequestInit } {
	if (!c.provider || !c.model)
		throw new PipelineError("no model configured: set LLM_PROVIDER and LLM_MODEL");
	const json = { "content-type": "application/json" };
	if (c.provider === "openai") {
		const base = (c.url ?? "https://api.openai.com/v1").replace(/\/+$/, "");
		return {
			url: `${base}/chat/completions`,
			init: {
				method: "POST",
				headers: { ...json, ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
				body: JSON.stringify({
					model: c.model,
					// Measured on qwen3:14b through ollama: at the default temperature, schema-constrained
					// output stayed valid JSON while its string values came back corrupted.
					temperature: 0,
					messages: [
						{ role: "system", content: SYSTEM },
						{ role: "user", content: userMessage(p) },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "extraction", strict: true, schema: SCHEMA },
					},
				}),
			},
		};
	}
	const base = (c.url ?? "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1$/, "");
	return {
		url: `${base}/v1/messages`,
		init: {
			method: "POST",
			headers: {
				...json,
				"anthropic-version": "2023-06-01",
				...(c.apiKey ? { "x-api-key": c.apiKey } : {}),
			},
			body: JSON.stringify({
				model: c.model,
				max_tokens: 2048,
				system: SYSTEM,
				messages: [{ role: "user", content: userMessage(p) }],
				output_config: { format: { type: "json_schema", schema: SCHEMA } },
			}),
		},
	};
}

/** The model's JSON, or a PipelineError that says why there is none. */
export function readReply(provider: "openai" | "anthropic", body: unknown): ModelOutput {
	let text: string | undefined;
	const b = body as Record<string, unknown>;
	if (provider === "openai") {
		const choice = (
			b.choices as { message?: { content?: string; refusal?: string } }[] | undefined
		)?.[0];
		if (choice?.message?.refusal)
			throw new PipelineError(`the model refused: ${choice.message.refusal}`);
		text = choice?.message?.content;
	} else {
		if (b.stop_reason === "refusal") throw new PipelineError("the model refused this page");
		const block = (b.content as { type: string; text?: string }[] | undefined)?.find(
			(x) => x.type === "text",
		);
		text = block?.text;
	}
	if (!text) throw new PipelineError("the model returned no text");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new PipelineError("the model's answer is not JSON");
	}
	const ok = OUTPUT.safeParse(parsed);
	if (!ok.success) throw new PipelineError("the model's answer does not fit the schema");
	return ok.data;
}

export async function askModel(c: ModelConfig, p: PageInput): Promise<ModelOutput> {
	const { url, init } = buildRequest(c, p);
	const res = await request(url, { ...init, timeoutMs: 120_000 });
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new PipelineError("the model server's answer is not JSON");
	}
	return readReply(c.provider as "openai" | "anthropic", body);
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const KEY = /^[a-z][a-z0-9_]*(:[a-z0-9_]+)*$/;
/** A model's own confidence is capped: its answer is not a registry row. */
const MODEL_CONF_CEILING = 0.9;
const CONTEXT = 60;

const digits = (s: string) => s.replace(/\(0\)/g, "").replace(/\D/g, "").replace(/^33/, "0");
const bareHost = (s: string) =>
	s
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\/+$/, "");

/**
 * The quote only proves the page says something; for values that are copied rather than
 * interpreted, the value itself must be in it. Otherwise a website "quoted" from the
 * email address next to it passes. Interpreted values (opening_hours, enums) are exempt.
 */
function valueInQuote(k: string, v: string, quote: string): boolean {
	const q = collapse(quote).toLowerCase();
	if (k === "phone" || k === "fax" || k.endsWith(":phone")) return digits(q).includes(digits(v));
	if (k === "website" || k.endsWith(":website"))
		return q.replace(/\S+@\S+/g, " ").includes(bareHost(v));
	if (k === "email" || k === "name" || k === "brand" || k.startsWith("addr:"))
		return q.includes(collapse(v).toLowerCase());
	return true;
}

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_RULE =
	/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))? (\d\d:\d\d-\d\d:\d\d(?:,\d\d:\d\d-\d\d:\d\d)*)$/;

/** A day's spans in order, overlapping or touching ones joined: `08:00-12:00,08:00-18:00` is `08:00-18:00`. */
function joinSpans(spans: Iterable<string>): string {
	const out: [string, string][] = [];
	for (const span of [...spans].sort()) {
		const [from, to] = span.split("-");
		const last = out.at(-1);
		// A span past midnight (22:00-02:00) is left as written.
		if (last && last[0] <= last[1] && from <= to && from <= last[1]) {
			if (to > last[1]) last[1] = to;
		} else out.push([from, to]);
	}
	return out.map(([from, to]) => `${from}-${to}`).join(",");
}

/**
 * Days spelled out one by one (`Mo 09:30-19:45, Tu 09:30-19:45, …`, a split day as two rules)
 * folded into ranges of days with the same spans, which OSM's prettifier does not do. Anything
 * but plain day rules comes back as it was, and so do rules naming a day twice across `;`,
 * where the later one replaces the earlier.
 */
function foldDays(v: string): string {
	const spans = new Map<number, Set<string>>();
	let repeated = false;
	for (const rule of v.trim().split(/\s*[;,]\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/)) {
		const m = DAY_RULE.exec(rule);
		if (!m) return v;
		const from = WEEK.indexOf(m[1]);
		const to = m[2] ? WEEK.indexOf(m[2]) : from;
		if (to < from) return v;
		for (let d = from; d <= to; d++) {
			repeated ||= spans.has(d);
			spans.set(d, new Set([...(spans.get(d) ?? []), ...m[3].split(",")]));
		}
	}
	if (repeated && v.includes(";")) return v;
	const day = (d: number) => joinSpans(spans.get(d) ?? []);
	if (WEEK.every((_, d) => day(d) === "00:00-24:00")) return "24/7";
	const out: string[] = [];
	for (let d = 0; d < 7; d++) {
		if (!spans.has(d)) continue;
		let end = d;
		while (end < 6 && spans.has(end + 1) && day(end + 1) === day(d)) end++;
		out.push(`${WEEK[d]}${end > d ? `-${WEEK[end]}` : ""} ${day(d)}`);
		d = end;
	}
	return out.join("; ");
}

/** OSM's own parser decides; a value it can only read with warnings is replaced by its normalised form. */
export function openingHours(v: string): string | null {
	const folded = foldDays(v);
	try {
		const oh = new OpeningHours(folded, null, 0);
		return oh.getWarnings().length ? oh.prettifyValue() : folded;
	} catch {
		return null;
	}
}

/** The page text around the quote, with the quote itself the marked span. Null when the text does not hold it. */
export function quoteParts(text: string, quote: string): { text: string; mark: boolean }[] | null {
	const t = collapse(text);
	const q = collapse(quote);
	if (!q) return null;
	let at = t.indexOf(q);
	if (at === -1) at = t.toLowerCase().indexOf(q.toLowerCase());
	if (at === -1) return null;
	const before = t.slice(Math.max(0, at - CONTEXT), at);
	const after = t.slice(at + q.length, at + q.length + CONTEXT);
	return [
		...(before ? [{ text: (at > CONTEXT ? "…" : "") + before, mark: false }] : []),
		{ text: t.slice(at, at + q.length), mark: true },
		...(after
			? [{ text: after + (at + q.length + CONTEXT < t.length ? "…" : ""), mark: false }]
			: []),
	];
}

/**
 * The model is a witness, not an authority: a tag survives only if its quote is really on
 * the page, its key is one the source may write, and its confidence clears the floor.
 */
export function vetTags(
	out: ModelOutput,
	page: { url: string; text: string; allow: string[]; floor: number; model: string },
): ProposedTag[] {
	const seen = new Set<string>();
	const kept: ProposedTag[] = [];
	for (const t of out.tags) {
		const k = t.k.trim();
		let v = t.v.trim();
		if (!KEY.test(k) || !v || v.length > OSM_MAX || seen.has(k)) continue;
		if (!valueInQuote(k, v, t.quote)) continue;
		if (k === "opening_hours") {
			const valid = openingHours(v);
			if (!valid) continue;
			v = valid;
		}
		if (!allowedBy(page.allow, k)) continue;
		const conf = Math.min(Math.max(t.confidence, 0), MODEL_CONF_CEILING);
		if (conf < page.floor) continue;
		const parts = quoteParts(page.text, t.quote);
		if (!parts) continue;
		seen.add(k);
		kept.push({
			k,
			v,
			conf: Math.round(conf * 100) / 100,
			path: new URL(page.url).pathname || "/",
			parts,
			kind: `model extraction · ${page.model}`,
		});
	}
	return kept;
}
