import { sirene as sireneHost } from "$lib/server/config";
import { getJson } from "../http";
import type { TagFunction } from "../mapping/evaluate";

const TIMEOUT_MS = 10_000;
/** The API allows 7 requests a second; this keeps under it. */
const MIN_GAP_MS = 160;
const CACHE_MS = 60 * 60_000;

interface Hit {
	siren?: string;
	nom_raison_sociale?: string | null;
	nature_juridique?: string | null;
}

interface Legal {
	siren: string;
	name: string;
}

/** `null` is a SIREN that is no legal entity or that the API does not know; a failure is cached as such too. */
const cache = new Map<string, { at: number; legal: Legal | null }>();
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Calls are serialised and spaced out, one process-wide gap for every run. */
function throttled<T>(job: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		const wait = lastCall + MIN_GAP_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastCall = Date.now();
		return job();
	});
	queue = run.catch(() => {});
	return run;
}

const sirenOf = (raw: string) => raw.replace(/\s/g, "");

/** Level 1 of the legal categories is the individual entrepreneur, a natural person whatever the trade. */
const legalCategory = /^[2-9]\d{3}$/;

/**
 * Looks the SIREN up once an hour and keeps the answer, so a register naming one operator on
 * a thousand devices asks once. Returns how many lookups failed this time, which the run says;
 * a failure leaves the SIREN unresolved and proposes nothing.
 */
export async function resolveSiren(raw: string): Promise<number> {
	const siren = sirenOf(raw);
	if (!/^\d{9}$/.test(siren)) return 0;
	const known = cache.get(siren);
	if (known && Date.now() - known.at < CACHE_MS) return 0;
	try {
		const url = `${sireneHost.url}/search?${new URLSearchParams({ q: siren, per_page: "1" })}`;
		const answer = await throttled(() =>
			getJson<{ results?: Hit[] }>(url, { timeoutMs: TIMEOUT_MS }),
		);
		const hit = answer.results?.find((r) => r.siren === siren);
		const name = hit?.nom_raison_sociale?.trim();
		const legal = name && legalCategory.test(hit?.nature_juridique ?? "") ? { siren, name } : null;
		cache.set(siren, { at: Date.now(), legal });
		return 0;
	} catch {
		cache.set(siren, { at: Date.now(), legal: null });
		return 1;
	}
}

export function clearSirenCache() {
	cache.clear();
}

/** The operator and its SIREN, only for a SIREN `resolveSiren` found to be a legal entity. */
export const sirene: TagFunction = ({ siren }) => {
	const legal = cache.get(sirenOf(siren))?.legal;
	return legal ? { operator: legal.name, "operator:ref:FR:SIREN": legal.siren } : {};
};
