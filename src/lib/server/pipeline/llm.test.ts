import { afterEach, describe, expect, it, vi } from "vitest";
import { askModel, buildRequest, openingHours, quoteParts, readReply, vetTags } from "./llm";

const page = {
	url: "https://shop.test/contact",
	text: "Ouvert du lundi au samedi de 9h à 19h.  Tél : 05 61 00 00 00",
	allow: [] as string[],
	model: "openai · m",
};

afterEach(() => vi.unstubAllGlobals());

describe("buildRequest", () => {
	it("posts an OpenAI-compatible chat completion with a strict JSON schema", () => {
		const { url, init } = buildRequest(
			{ provider: "openai", url: "http://localhost:11434/v1/", model: "m", apiKey: "k" },
			page,
		);
		expect(url).toBe("http://localhost:11434/v1/chat/completions");
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("m");
		expect(body.response_format.type).toBe("json_schema");
		expect(body.response_format.json_schema.strict).toBe(true);
		expect(body.temperature).toBe(0);
		expect(body.messages[1].content).toContain(page.text);
		expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
	});

	it("posts to the Messages API with structured output and no sampling or thinking budget", () => {
		const { url, init } = buildRequest(
			{ provider: "anthropic", url: undefined, model: "claude-sonnet-5-5", apiKey: "k" },
			{ ...page, current: { name: "Chez Paul" } },
		);
		expect(url).toBe("https://api.anthropic.com/v1/messages");
		const h = init.headers as Record<string, string>;
		expect(h["x-api-key"]).toBe("k");
		expect(h["anthropic-version"]).toBe("2023-06-01");
		const body = JSON.parse(init.body as string);
		expect(body.output_config.format.type).toBe("json_schema");
		expect(body.temperature).toBeUndefined();
		expect(body.thinking).toBeUndefined();
		expect(body.messages[0].content).toContain("Chez Paul");
	});

	it("does not double /v1 on an Anthropic base that already has it", () => {
		const { url } = buildRequest(
			{ provider: "anthropic", url: "https://proxy.test/v1/", model: "m", apiKey: undefined },
			page,
		);
		expect(url).toBe("https://proxy.test/v1/messages");
	});

	it("fails with the message the source screen shows when no model is set", () => {
		expect(() =>
			buildRequest({ provider: null, url: undefined, model: undefined, apiKey: undefined }, page),
		).toThrow(/no model configured/);
	});
});

describe("readReply", () => {
	const out = {
		tags: [{ k: "phone", v: "+33 5 61 00 00 00", confidence: 0.9, quote: "05 61 00 00 00" }],
	};

	it("reads both providers' envelopes", () => {
		expect(
			readReply("openai", { choices: [{ message: { content: JSON.stringify(out) } }] }),
		).toEqual(out);
		expect(
			readReply("anthropic", { content: [{ type: "text", text: JSON.stringify(out) }] }),
		).toEqual(out);
	});

	it("rejects a refusal, non-JSON and a wrong shape", () => {
		expect(() => readReply("anthropic", { stop_reason: "refusal", content: [] })).toThrow(
			/refused/,
		);
		expect(() => readReply("openai", { choices: [{ message: { content: "nope" } }] })).toThrow(
			/not JSON/,
		);
		expect(() =>
			readReply("openai", { choices: [{ message: { content: '{"tags":3}' } }] }),
		).toThrow(/schema/);
	});
});

describe("vetTags", () => {
	const out = (tags: { k: string; v: string; confidence: number; quote: string }[]) => ({
		tags,
	});
	const ok = { k: "phone", v: "+33 5 61 00 00 00", confidence: 0.8, quote: "Tél : 05 61 00 00 00" };

	it("keeps a tag whose quote is on the page and marks the span", () => {
		const [t] = vetTags(out([ok]), { ...page, floor: 0.5 });
		expect(t).toMatchObject({
			k: "phone",
			conf: 0.8,
			path: "/contact",
			kind: "model extraction · openai · m",
		});
		expect(t.parts.find((p) => p.mark)?.text).toBe("Tél : 05 61 00 00 00");
	});

	it("drops invented quotes, low confidence, disallowed keys, bad keys and duplicates", () => {
		const tags = vetTags(
			out([
				{ ...ok, quote: "never on the page" },
				{ ...ok, k: "email", confidence: 0.3, quote: "Ouvert" },
				{ ...ok, k: "website", quote: "Ouvert" },
				{ ...ok, k: "Bad Key", quote: "Ouvert" },
				{
					...ok,
					k: "opening_hours",
					v: "Mo-Sa 09:00-19:00",
					quote: "Ouvert du lundi au samedi de 9h à 19h",
				},
				{ ...ok, k: "opening_hours", v: "other", quote: "Ouvert" },
			]),
			{ ...page, allow: ["opening_hours", "email", "phone"], floor: 0.5 },
		);
		expect(tags.map((t) => t.k)).toEqual(["opening_hours"]);
	});

	it("drops copied values that are not in their own quote", () => {
		const text =
			"Gelato Lab, 5 rue X. hello@gelatolab.fr. Site réalisé par WebAgence – webagence.fr";
		const tags = vetTags(
			out([
				{ ...ok, k: "website", v: "gelatolab.fr", quote: "hello@gelatolab.fr" },
				{ ...ok, k: "email", v: "hello@gelatolab.fr", quote: "hello@gelatolab.fr" },
				{ ...ok, k: "brand", v: "Gelato Lab", quote: "5 rue X" },
			]),
			{ ...page, text, floor: 0 },
		);
		expect(tags.map((t) => t.k)).toEqual(["email"]);
	});

	it("holds every email, mobile and fax key to its quote, and a number to having digits", () => {
		const text = "Collège Jean Moulin. Contactez-nous au secrétariat. Tél : 05 61 00 00 00";
		const quote = "Contactez-nous au secrétariat";
		const tags = vetTags(
			out([
				{ ...ok, k: "contact:email", v: "made.up@example.org", quote },
				{ ...ok, k: "school:email", v: "made.up@example.org", quote },
				{ ...ok, k: "mobile", v: "+33 6 12 34 56 78", quote },
				{ ...ok, k: "contact:mobile", v: "06 12 34 56 78", quote },
				{ ...ok, k: "contact:fax", v: "05 61 99 99 99", quote },
				{ ...ok, k: "phone", v: "N/A", quote },
				{ ...ok, k: "contact:phone", v: "05 61 00 00 00", quote: "Tél : 05 61 00 00 00" },
			]),
			{ ...page, text, floor: 0 },
		);
		expect(tags.map((t) => t.k)).toEqual(["contact:phone"]);
	});

	it("finds a number in its quote across spellings, overseas codes included", () => {
		const text = "2 rue du Port, 97400 Saint-Denis. Tél : 0262 12 34 56. Fax +33 (0)4 72 00 00 00";
		const tags = vetTags(
			out([
				{
					...ok,
					k: "phone",
					v: "+262 262 12 34 56",
					quote: "97400 Saint-Denis. Tél : 0262 12 34 56",
				},
				{ ...ok, k: "fax", v: "+33 4 72 00 00 00", quote: "Fax +33 (0)4 72 00 00 00" },
				{ ...ok, k: "mobile", v: "+262 692 12 34 56", quote: "Tél : 0262 12 34 56" },
			]),
			{ ...page, text, floor: 0 },
		);
		expect(tags.map((t) => t.k)).toEqual(["phone", "fax"]);
	});

	it("groups an address's parts, so it is accepted whole or not at all", () => {
		const text = "Nous trouver : 12 rue des Lilas, 31000 Toulouse. Tél : 05 61 00 00 00";
		const tags = vetTags(
			out([
				{ ...ok, k: "addr:housenumber", v: "12", quote: "12 rue des Lilas" },
				{ ...ok, k: "addr:street", v: "Rue des Lilas", quote: "12 rue des Lilas" },
				{ ...ok, k: "addr:postcode", v: "31000", quote: "31000 Toulouse" },
				ok,
			]),
			{ ...page, text, floor: 0 },
		);
		expect(tags.map((t) => [t.k, t.group])).toEqual([
			["addr:housenumber", "addr"],
			["addr:street", "addr"],
			["addr:postcode", "addr"],
			["phone", undefined],
		]);
	});

	it("matches phone numbers by digits, whatever the formatting", () => {
		const [t] = vetTags(out([{ ...ok, v: "+33561000000" }]), { ...page, floor: 0 });
		expect(t?.v).toBe("+33561000000");
	});

	it("normalises loosely written opening_hours and drops unparseable ones", () => {
		const text = "Ouvert du mercredi au dimanche de 18h à 1h";
		const tags = vetTags(
			out([
				{ ...ok, k: "opening_hours", v: "Wed-Sun 18:00-1:00", quote: text },
				{ ...ok, k: "opening_hours", v: "permanently_closed", quote: text },
			]),
			{ ...page, text, floor: 0 },
		);
		expect(tags.map((t) => t.v)).toEqual(["We-Su 18:00-01:00"]);
	});

	it("never lets the model claim more than its ceiling", () => {
		const [t] = vetTags(out([{ ...ok, confidence: 1 }]), { ...page, floor: 0 });
		expect(t.conf).toBeLessThanOrEqual(0.9);
	});
});

describe("openingHours", () => {
	it("keeps valid values as written", () => {
		expect(openingHours("Mo-Su 08:00-18:00; PH off")).toBe("Mo-Su 08:00-18:00; PH off");
		expect(openingHours("nonsense")).toBeNull();
	});

	it("folds days with the same spans, but not a day a later rule replaces", () => {
		expect(openingHours("Mo 08:00-18:00, Tu 08:00-18:00, Th 08:00-18:00")).toBe(
			"Mo-Tu 08:00-18:00; Th 08:00-18:00",
		);
		expect(openingHours("Mo-Fr 08:00-18:00; Fr 08:00-12:00")).toBe(
			"Mo-Fr 08:00-18:00; Fr 08:00-12:00",
		);
	});
});

describe("quoteParts", () => {
	it("is whitespace-insensitive and null when absent", () => {
		expect(quoteParts("a  b\n c", "b c")?.some((p) => p.mark)).toBe(true);
		expect(quoteParts("abc", "zzz")).toBeNull();
	});
});

describe("askModel", () => {
	it("sends the request through fetch with a timeout signal and the project user agent", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				choices: [{ message: { content: JSON.stringify({ tags: [] }) } }],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const res = await askModel(
			{ provider: "openai", url: "http://llm.test/v1", model: "m", apiKey: undefined },
			page,
		);
		expect(res.tags).toEqual([]);
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect((init.headers as Record<string, string>)["user-agent"]).toMatch(
			/^osm-reviewer\/\S+ \(\+/,
		);
	});

	it("reports an HTTP error as a pipeline failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("no", { status: 401, statusText: "Unauthorized" })),
		);
		await expect(
			askModel({ provider: "anthropic", url: undefined, model: "m", apiKey: "bad" }, page),
		).rejects.toThrow(/401/);
	});
});
