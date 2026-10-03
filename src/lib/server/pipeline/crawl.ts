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
	const mine = agent.toLowerCase();
	const own = groups.find((g) => g.agents.some((a) => a !== "*" && mine.includes(a)));
	return (own ?? groups.find((g) => g.agents.includes("*")))?.rules ?? { allow: [], disallow: [] };
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

export const TEXT_LIMIT = 12_000;

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
	return (text + (ld.length ? "\n\nStructured data: " + ld.join("\n") : "")).slice(0, TEXT_LIMIT);
}

const HINT = /contact|horaire|hours|infos?|pratique|acc[eè]s|about|a-propos|qui-sommes/i;

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
	) {}

	get exhausted() {
		return this.pages >= this.budget.pages;
	}

	private async allowed(u: URL): Promise<boolean> {
		let rules = this.robots.get(u.host);
		if (rules === undefined) {
			try {
				const res = await this.polite(new URL("/robots.txt", u), [404, 410]);
				rules = res.ok
					? parseRobots(await res.text(), this.userAgent)
					: { allow: [], disallow: [] };
			} catch {
				rules = null;
			}
			this.robots.set(u.host, rules);
		}
		return rules !== null && robotsAllows(rules, u.pathname + u.search);
	}

	private async polite(u: URL, ok: number[] = []): Promise<Response> {
		const wait = (this.lastAt.get(u.host) ?? 0) + this.budget.delayMs - Date.now();
		if (wait > 0) await sleep(wait);
		this.lastAt.set(u.host, Date.now());
		return request(u.toString(), { timeoutMs: PAGE_TIMEOUT_MS, redirect: "follow" }, ok);
	}

	private async page(u: URL): Promise<{ html: string } | null> {
		if (this.exhausted || !(await this.allowed(u))) return null;
		this.pages += 1;
		const res = await this.polite(u);
		if (!/html|xml/i.test(res.headers.get("content-type") ?? "")) {
			await res.body?.cancel().catch(() => {});
			return null;
		}
		return { html: (await res.text()).slice(0, PAGE_BYTES) };
	}

	/** The seed page and the couple of same-host pages most likely to carry contact details. Null when robots.txt or the budget stops it. */
	async fetchSeed(url: string): Promise<CrawlResult | null> {
		let seed: URL;
		try {
			seed = new URL(/^https?:\/\//i.test(url) ? url : "https://" + url);
		} catch {
			return null;
		}
		const first = await this.page(seed);
		if (!first) return null;
		const texts = [htmlToText(first.html)];
		for (const link of sameHostLinks(first.html, seed).slice(0, FOLLOW_PER_SEED)) {
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
