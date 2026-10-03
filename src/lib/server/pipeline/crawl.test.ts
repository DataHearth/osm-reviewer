import { describe, expect, it } from "vitest";
import {
	htmlToText,
	parseBudget,
	parseRobots,
	parseSeedRule,
	robotsAllows,
	sameHostLinks,
} from "./crawl";

describe("parseBudget", () => {
	it("reads pages and per-host delay", () => {
		expect(parseBudget("400 pages / run · 1 request / 4 s per host")).toEqual({
			pages: 400,
			delayMs: 4000,
		});
		expect(parseBudget("")).toEqual({ pages: 100, delayMs: 4000 });
		expect(parseBudget("50 pages, 1 request / 0.5 s")).toEqual({ pages: 50, delayMs: 500 });
	});
});

describe("parseSeedRule", () => {
	it("accepts URLs and tag requirements", () => {
		expect(parseSeedRule("website=* on POIs inside the area")).toMatchObject({
			urls: [],
			require: [{ k: "website", v: null }],
		});
		expect(parseSeedRule("https://a.test/x, https://b.test").urls).toEqual([
			"https://a.test/x",
			"https://b.test",
		]);
	});

	it("rejects a rule that seeds nothing", () => {
		expect(() => parseSeedRule("everything")).toThrow(/seed rule/);
	});
});

describe("robots.txt", () => {
	const txt = `
User-agent: *
Disallow: /private
Allow: /private/open
Disallow: /*.pdf$

User-agent: osm-reviewer
Disallow: /blocked
`;
	it("applies the longest matching rule, allow winning ties", () => {
		const r = parseRobots(txt, "other-bot/1");
		expect(robotsAllows(r, "/private/x")).toBe(false);
		expect(robotsAllows(r, "/private/open/x")).toBe(true);
		expect(robotsAllows(r, "/doc.pdf")).toBe(false);
		expect(robotsAllows(r, "/doc.pdf?x=1")).toBe(true);
		expect(robotsAllows(r, "/")).toBe(true);
	});

	it("prefers a group naming this crawler", () => {
		const r = parseRobots(txt, "osm-reviewer/0.9 (+https://x)");
		expect(robotsAllows(r, "/blocked/a")).toBe(false);
		expect(robotsAllows(r, "/private/a")).toBe(true);
	});
});

describe("htmlToText", () => {
	it("drops scripts and tags, decodes entities and keeps JSON-LD", () => {
		const text = htmlToText(
			`<html><head><title>T</title><style>p{}</style><script>alert(1)</script>
			<script type="application/ld+json">{"openingHours":"Mo-Fr 09:00-18:00"}</script></head>
			<body><p>Horaires&nbsp;: lundi &amp; mardi</p><div>Tél 05 61 &#233;</div></body></html>`,
		);
		expect(text).toContain("Horaires : lundi & mardi");
		expect(text).toContain("Tél 05 61 é");
		expect(text).toContain('"openingHours":"Mo-Fr 09:00-18:00"');
		expect(text).not.toContain("alert");
		expect(text).not.toContain("p{}");
	});
});

describe("sameHostLinks", () => {
	it("keeps contact-like links on the same host only", () => {
		const html = `<a href="/contact">Nous</a><a href="https://other.test/contact">x</a><a href="/produits">Produits</a><a href="/a">Horaires</a>`;
		expect(sameHostLinks(html, new URL("https://a.test/")).sort()).toEqual([
			"https://a.test/a",
			"https://a.test/contact",
		]);
	});
});
