import { afterEach, describe, expect, it, vi } from "vitest";
import {
	Crawler,
	htmlToText,
	isPublicAddress,
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

	it("merges every group for the product token, and never matches by substring", () => {
		const agent = "osm-reviewer/1.0 (+https://rev.example.org)";
		const both = parseRobots(
			"User-agent: *\nDisallow: /a\n\nUser-agent: *\nDisallow: /private\n",
			agent,
		);
		expect(robotsAllows(both, "/a/x")).toBe(false);
		expect(robotsAllows(both, "/private/x")).toBe(false);

		const named = parseRobots(
			"User-agent: OSM-Reviewer\nDisallow: /a\n\nUser-agent: example\nAllow: /\n\nUser-agent: osm-reviewer\nDisallow: /b\n\nUser-agent: *\nDisallow: /\n",
			agent,
		);
		expect(robotsAllows(named, "/a/x")).toBe(false);
		expect(robotsAllows(named, "/b/x")).toBe(false);
		expect(robotsAllows(named, "/c")).toBe(true);

		const foreign = parseRobots(
			"User-agent: example\nAllow: /\n\nUser-agent: *\nDisallow: /\n",
			agent,
		);
		expect(robotsAllows(foreign, "/x")).toBe(false);
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

describe("Crawler", () => {
	afterEach(() => vi.unstubAllGlobals());

	const html = (body: string, headers: Record<string, string> = {}) =>
		new Response(body, { headers: { "content-type": "text/html", ...headers } });
	const resolve = async (host: string) =>
		({ "a.test": ["203.0.113.1"], "www.a.test": ["203.0.113.2"], "lan.test": ["192.168.1.4"] })[
			host
		] ?? ["203.0.113.9"];
	const crawl = (routes: Record<string, () => Response>) => {
		const seen: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (u: string) => {
				seen.push(u);
				return routes[u]?.() ?? new Response("", { status: 404 });
			}),
		);
		return { seen, crawler: new Crawler({ pages: 10, delayMs: 0 }, "osm-reviewer/1", resolve) };
	};
	const to = (location: string) => () => new Response(null, { status: 301, headers: { location } });

	it("tells public addresses from loopback, private, link-local, CGNAT and unique-local ones", () => {
		for (const ip of ["203.0.113.1", "2001:db8::1", "::ffff:8.8.8.8"])
			expect(isPublicAddress(ip), ip).toBe(true);
		for (const ip of [
			"127.0.0.1",
			"0.0.0.0",
			"10.1.2.3",
			"172.20.0.1",
			"192.168.1.4",
			"169.254.169.254",
			"100.64.0.1",
			"::1",
			"fe80::1",
			"fd12::1",
			"::ffff:127.0.0.1",
		])
			expect(isPublicAddress(ip), ip).toBe(false);
	});

	it("refuses a seed on a private address before fetching anything", async () => {
		const { seen, crawler } = crawl({});
		await expect(crawler.fetchSeed("http://lan.test/")).rejects.toThrow(/not a public address/);
		await expect(crawler.fetchSeed("http://[::1]:8080/")).rejects.toThrow(/not a public address/);
		await expect(crawler.fetchSeed("http://127.0.0.1/")).rejects.toThrow(/not a public address/);
		expect(seen).toEqual([]);
	});

	it("follows a redirect within the site under robots.txt, and none that leaves it", async () => {
		const { seen, crawler } = crawl({
			"http://a.test/": to("https://www.a.test/home"),
			"https://www.a.test/robots.txt": () => new Response("User-agent: *\nDisallow: /private"),
			"https://www.a.test/home": () => html("<p>Bienvenue</p>"),
			"http://a.test/robots.txt": () => new Response(""),
			"http://a.test/away": to("http://lan.test/"),
			"http://a.test/elsewhere": to("https://b.test/"),
			"http://a.test/hidden": to("https://www.a.test/private/x"),
		});
		expect((await crawler.fetchSeed("http://a.test/"))?.text).toBe("Bienvenue");
		await expect(crawler.fetchSeed("http://a.test/away")).resolves.toBeNull();
		await expect(crawler.fetchSeed("http://a.test/elsewhere")).resolves.toBeNull();
		await expect(crawler.fetchSeed("http://a.test/hidden")).resolves.toBeNull();
		expect(seen).not.toContain("https://www.a.test/private/x");
		expect(seen).not.toContain("https://b.test/");
	});

	it("skips a page that declares itself too big and stops reading one that never ends", async () => {
		const chunk = new TextEncoder().encode("<p>more</p>".repeat(6_000));
		const endless = () =>
			new Response(new ReadableStream({ pull: (c) => c.enqueue(chunk) }), {
				headers: { "content-type": "text/html" },
			});
		const { crawler } = crawl({
			"https://a.test/declared": () => html("<p>small</p>", { "content-length": "9999999" }),
			"https://a.test/endless": endless,
		});
		await expect(crawler.fetchSeed("https://a.test/declared")).resolves.toBeNull();
		expect((await crawler.fetchSeed("https://a.test/endless"))?.text).toMatch(/^more\nmore/);
	});
});
