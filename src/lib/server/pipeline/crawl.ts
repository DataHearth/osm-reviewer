import { lookup } from "node:dns/promises";
import { BlockList, isIP, isIPv6 } from "node:net";
import { LINK_HINTS } from "./fr/words";
import { request, sleep } from "./http";
import { parseMatching, type Selector } from "./tagfilter";
import { PipelineError } from "./types";

export interface Budget {
	pages: number;
	/** Between two requests to one host. */
	delayMs: number;
}

const DEFAULT_BUDGET: Budget = { pages: 100, delayMs: 4000 };

/** "400 pages / run · 1 request / 4 s per host" */
export function parseBudget(text: string): Budget {
	const pages = /(\d+)\s*pages?/i.exec(text);
	const delay = /1\s*request\s*\/\s*(\d+(?:\.\d+)?)\s*s/i.exec(text);
	return {
		pages: pages ? Number(pages[1]) : DEFAULT_BUDGET.pages,
		delayMs: delay ? Math.round(Number(delay[1]) * 1000) : DEFAULT_BUDGET.delayMs,
	};
}

export interface SeedRule {
	urls: string[];
	/** `website=*`: crawl the pages OSM POIs in the area point at, whatever tag they carry it in. */
	require: Selector[];
}

export function parseSeedRule(text: string): SeedRule {
	const urls = [...text.matchAll(/https?:\/\/[^\s,;]+/g)].map((m) => m[0]);
	const rest = text.replace(/https?:\/\/[^\s,;]+/g, " ");
	const require = parseMatching(rest);
	if (urls.length === 0 && require.length === 0)
		throw new PipelineError("the seed rule is neither a URL nor a key=value on OSM POIs");
	return { urls, require };
}

type Rules = { allow: string[]; disallow: string[] };

export function parseRobots(txt: string, agent: string): Rules {
	const groups: { agents: string[]; rules: Rules }[] = [];
	let cur: { agents: string[]; rules: Rules } | null = null;
	let lastWasAgent = false;
	for (const raw of txt.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "").trim();
		const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
		if (!m) continue;
		const field = m[1].toLowerCase();
		const value = m[2].trim();
		if (field === "user-agent") {
			if (!cur || !lastWasAgent) {
				cur = { agents: [], rules: { allow: [], disallow: [] } };
				groups.push(cur);
			}
			cur.agents.push(value.toLowerCase());
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if (!cur) continue;
		if (field === "allow") cur.rules.allow.push(value);
		else if (field === "disallow" && value) cur.rules.disallow.push(value);
	}
	// RFC 9309 §2.2.1: groups are matched on the product token alone, every group naming
	// it counts, and `*` only applies when none does.
	const product = agent.split("/")[0].trim().toLowerCase();
	const named = groups.filter((g) => g.agents.some((a) => a.split("/")[0].trim() === product));
	const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
	return {
		allow: chosen.flatMap((g) => g.rules.allow),
		disallow: chosen.flatMap((g) => g.rules.disallow),
	};
}

function ruleMatches(rule: string, path: string): boolean {
	const anchored = rule.endsWith("$");
	const body = anchored ? rule.slice(0, -1) : rule;
	const re = new RegExp(
		"^" +
			body
				.split("*")
				.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
				.join(".*") +
			(anchored ? "$" : ""),
	);
	return re.test(path);
}

/** Longest matching rule wins; on a tie, allow does. */
export function robotsAllows(rules: Rules, path: string): boolean {
	let best = { len: -1, allow: true };
	for (const [list, allow] of [
		[rules.allow, true],
		[rules.disallow, false],
	] as const)
		for (const r of list)
			if (ruleMatches(r, path) && (r.length > best.len || (r.length === best.len && allow)))
				best = { len: r.length, allow };
	return best.allow;
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

const TEXT_LIMIT = 12_000;

/** Visible text plus any JSON-LD, which is where sites keep their opening hours. */
export function htmlToText(html: string): string {
	const ld = [
		...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
	].map((m) => m[1].trim());
	const text = html
		.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|footer|header|td)\b[^>]*>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
			if (e[0] === "#") {
				const code =
					e[1].toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
				return Number.isFinite(code) && code > 0 && code < 0x110000
					? String.fromCodePoint(code)
					: " ";
			}
			return ENTITIES[e.toLowerCase()] ?? m;
		})
		.replace(/[ \t\f\v ]+/g, " ")
		.replace(/ *\n[ \n]*/g, "\n")
		.trim();
	return (text + (ld.length ? `\n\nStructured data: ${ld.join("\n")}` : "")).slice(0, TEXT_LIMIT);
}

const HINT = new RegExp(`contact|hours|infos?|about|${LINK_HINTS.join("|")}`, "i");

export function sameHostLinks(html: string, base: URL): string[] {
	const out = new Set<string>();
	for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
		try {
			const u = new URL(m[1], base);
			if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
			if (HINT.test(u.pathname) || HINT.test(m[2].replace(/<[^>]+>/g, ""))) out.add(u.toString());
		} catch {
			// not a URL
		}
	}
	return [...out];
}

const FOLLOW_PER_SEED = 2;
const PAGE_TIMEOUT_MS = 15_000;
const PAGE_BYTES = 1_500_000;
const ROBOTS_BYTES = 500_000;
const REDIRECTS = [301, 302, 303, 307, 308];
const MAX_HOPS = 5;

/** Where a URL from OSM must never lead the server: itself, its network, its cloud's metadata. */
const NOT_PUBLIC = new BlockList();
for (const [net, bits] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
	["224.0.0.0", 3],
] as const)
	NOT_PUBLIC.addSubnet(net, bits, "ipv4");
// BlockList checks an IPv4-mapped IPv6 address against the IPv4 rules above; a
// `::ffff:0:0/96` rule here would instead match every IPv4 address.
for (const [net, bits] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const)
	NOT_PUBLIC.addSubnet(net, bits, "ipv6");

export const isPublicAddress = (ip: string) => !NOT_PUBLIC.check(ip, isIPv6(ip) ? "ipv6" : "ipv4");

export type Resolve = (host: string) => Promise<string[]>;
const resolveHost: Resolve = async (host) =>
	(await lookup(host, { all: true })).map((a) => a.address);

/** A site and its `www.` twin are one, so `http://a.fr` redirecting to `https://www.a.fr` stays on it. */
const site = (u: URL) => u.hostname.replace(/^www\./, "");

/** At most `cap` bytes of the body: the stream is cut there, not read whole and then sliced. */
async function readCapped(res: Response, cap: number): Promise<string> {
	if (!res.body) return "";
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < cap) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.length;
	}
	await reader.cancel().catch(() => {});
	return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, cap));
}

export interface CrawlResult {
	text: string;
	url: string;
	pages: number;
}

/** One crawl: the budget, politeness and robots.txt are shared across every seed in it. */
export class Crawler {
	pages = 0;
	private readonly lastAt = new Map<string, number>();
	private readonly robots = new Map<string, Rules | null>();

	constructor(
		private readonly budget: Budget,
		private readonly userAgent: string,
		private readonly resolve: Resolve = resolveHost,
	) {}

	get exhausted() {
		return this.pages >= this.budget.pages;
	}

	private async allowed(u: URL): Promise<boolean> {
		let rules = this.robots.get(u.host);
		if (rules === undefined) {
			try {
				const got = await this.follow(new URL("/robots.txt", u), [404, 410], false);
				if (!got) rules = null;
				else if (got.res.ok)
					rules = parseRobots(await readCapped(got.res, ROBOTS_BYTES), this.userAgent);
				else {
					await got.res.body?.cancel().catch(() => {});
					rules = { allow: [], disallow: [] };
				}
			} catch {
				rules = null;
			}
			this.robots.set(u.host, rules);
		}
		return rules !== null && robotsAllows(rules, u.pathname + u.search);
	}

	private async assertPublic(u: URL) {
		const host = u.hostname.replace(/^\[(.*)\]$/, "$1");
		let addresses: string[];
		try {
			addresses = isIP(host) ? [host] : await this.resolve(host);
		} catch (err) {
			throw new PipelineError(`${host}: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (addresses.length === 0 || !addresses.every(isPublicAddress))
			throw new PipelineError(`${host}: refused, not a public address`);
	}

	private async polite(u: URL, ok: number[]): Promise<Response> {
		const wait = (this.lastAt.get(u.host) ?? 0) + this.budget.delayMs - Date.now();
		if (wait > 0) await sleep(wait);
		this.lastAt.set(u.host, Date.now());
		return request(u.toString(), { timeoutMs: PAGE_TIMEOUT_MS, redirect: "manual" }, ok);
	}

	/**
	 * Follows redirects by hand, so every hop is held to the starting site, to a public
	 * address and, for a page, to robots.txt. Null when a hop breaks one of those.
	 */
	private async follow(
		start: URL,
		ok: number[],
		robots: boolean,
	): Promise<{ res: Response; url: URL } | null> {
		let at = start;
		for (let hop = 0; hop <= MAX_HOPS; hop++) {
			await this.assertPublic(at);
			if (robots) {
				if (!(await this.allowed(at))) return null;
				this.pages += 1;
			}
			const res = await this.polite(at, [...ok, ...REDIRECTS]);
			if (!REDIRECTS.includes(res.status)) return { res, url: at };
			await res.body?.cancel().catch(() => {});
			const next = URL.parse(res.headers.get("location") ?? "", at);
			if (!next || !/^https?:$/.test(next.protocol) || site(next) !== site(start)) return null;
			at = next;
		}
		return null;
	}

	private async page(u: URL): Promise<{ html: string; url: URL } | null> {
		if (this.exhausted) return null;
		const got = await this.follow(u, [], true);
		if (!got) return null;
		const { res, url } = got;
		if (
			!/html|xml/i.test(res.headers.get("content-type") ?? "") ||
			Number(res.headers.get("content-length") ?? 0) > PAGE_BYTES
		) {
			await res.body?.cancel().catch(() => {});
			return null;
		}
		return { html: await readCapped(res, PAGE_BYTES), url };
	}

	/** The seed page and the couple of same-host pages most likely to carry contact details. Null when robots.txt, the budget or a redirect off the site stops it. */
	async fetchSeed(url: string): Promise<CrawlResult | null> {
		let seed: URL;
		try {
			seed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
		} catch {
			return null;
		}
		const first = await this.page(seed);
		if (!first) return null;
		const texts = [htmlToText(first.html)];
		for (const link of sameHostLinks(first.html, first.url).slice(0, FOLLOW_PER_SEED)) {
			try {
				const more = await this.page(new URL(link));
				if (more) texts.push(htmlToText(more.html));
			} catch {
				// a dead sub-page does not fail the seed
			}
		}
		return {
			url: seed.toString(),
			text: texts.join("\n\n").slice(0, TEXT_LIMIT),
			pages: texts.length,
		};
	}
}
