import { osm } from "$lib/server/config";
import { CREATED_BY } from "$lib/server/instance";
import { changesetXml, type OsmElement } from "./osmchange";

const TIMEOUT_MS = 20_000;
/** OSM can take a while to apply a large diff, and an upload given up on has an unknown outcome. */
const UPLOAD_TIMEOUT_MS = 60_000;
const BATCH = 100;

export class OsmError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message);
	}
}

export const userAgent = () => `${CREATED_BY} (+${process.env.ORIGIN ?? "http://localhost"})`;

async function call(path: string, init: RequestInit & { token?: string; timeout?: number }) {
	const { token, headers, timeout = TIMEOUT_MS, ...rest } = init;
	let res: Response;
	try {
		res = await fetch(osm.url + path, {
			signal: AbortSignal.timeout(timeout),
			...rest,
			headers: {
				"User-Agent": userAgent(),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...headers,
			},
		});
	} catch (err) {
		const timedOut = err instanceof Error && err.name === "TimeoutError";
		throw new OsmError(
			timedOut ? `${osm.url} did not answer in ${timeout / 1000} s` : `${osm.url} is unreachable`,
			null,
		);
	}
	if (!res.ok) {
		const body = (await res.text().catch(() => "")).trim().slice(0, 300);
		throw new OsmError(`${res.status} ${body || res.statusText}`.trim(), res.status);
	}
	return res;
}

export interface OsmUser {
	id: number;
	name: string;
}

export async function userDetails(token: string): Promise<OsmUser> {
	const res = await call("/api/0.6/user/details.json", { token });
	const body = (await res.json()) as { user?: { id: number; display_name: string } };
	if (!body.user) throw new OsmError("user details carried no user", null);
	return { id: body.user.id, name: body.user.display_name };
}

interface RawElement {
	type: OsmElement["type"];
	id: number;
	version: number;
	user?: string;
	visible?: boolean;
	lat?: number;
	lon?: number;
	tags?: Record<string, string>;
	nodes?: number[];
	members?: OsmElement["members"];
}

const toElement = (e: RawElement): OsmElement => ({
	type: e.type,
	id: e.id,
	version: e.version,
	user: e.user,
	lat: e.lat,
	lon: e.lon,
	tags: e.tags ?? {},
	nodes: e.nodes,
	members: e.members,
});

const parseRef = (ref: string) => {
	const [type, id] = ref.split("/");
	if ((type !== "node" && type !== "way" && type !== "relation") || !/^\d+$/.test(id))
		throw new OsmError(`"${ref}" is not an OSM object reference`, null);
	return { type, id: Number(id) } as const;
};

/**
 * The current state of each object, keyed by its `type/id`. An object OSM has deleted
 * is absent from the result; the caller decides what that means for its candidate.
 */
export async function fetchElements(token: string, refs: string[]) {
	const found = new Map<string, OsmElement>();
	for (const type of ["node", "way", "relation"] as const) {
		const ids = [
			...new Set(
				refs
					.map(parseRef)
					.filter((r) => r.type === type)
					.map((r) => r.id),
			),
		];
		for (let i = 0; i < ids.length; i += BATCH) {
			const batch = ids.slice(i, i + BATCH);
			const res = await call(`/api/0.6/${type}s.json?${type}s=${batch.join(",")}`, { token }).catch(
				(err) => {
					// A deleted object fails the whole batch; asking one at a time says which.
					if (err instanceof OsmError && (err.status === 404 || err.status === 410)) return null;
					throw err;
				},
			);
			const elements = res
				? ((await res.json()) as { elements: RawElement[] }).elements
				: await fetchEach(token, type, batch);
			for (const e of elements) if (e.visible !== false) found.set(`${type}/${e.id}`, toElement(e));
		}
	}
	return found;
}

async function fetchEach(token: string, type: string, ids: number[]) {
	const out: RawElement[] = [];
	for (const id of ids) {
		try {
			const res = await call(`/api/0.6/${type}/${id}.json`, { token });
			out.push(...((await res.json()) as { elements: RawElement[] }).elements);
		} catch (err) {
			if (!(err instanceof OsmError && (err.status === 404 || err.status === 410))) throw err;
		}
	}
	return out;
}

const XML = { "Content-Type": "text/xml" };

export async function createChangeset(token: string, tags: Record<string, string>) {
	const res = await call("/api/0.6/changeset/create", {
		method: "PUT",
		token,
		headers: XML,
		body: changesetXml(tags, CREATED_BY),
	});
	const id = (await res.text()).trim();
	if (!/^\d+$/.test(id)) throw new OsmError(`changeset create answered "${id.slice(0, 80)}"`, null);
	return id;
}

export async function uploadChange(token: string, changeset: string, xml: string) {
	await call(`/api/0.6/changeset/${changeset}/upload`, {
		method: "POST",
		token,
		headers: XML,
		body: xml,
		timeout: UPLOAD_TIMEOUT_MS,
	});
}

/** How many changes a changeset holds, which is how an upload that got no answer learns whether it landed. */
export async function changesetChanges(token: string, changeset: string) {
	const res = await call(`/api/0.6/changeset/${changeset}.json`, { token });
	const body = (await res.json()) as { changeset?: { changes_count?: unknown } };
	const count = body.changeset?.changes_count;
	if (typeof count !== "number")
		throw new OsmError("the changeset read carried no change count", null);
	return count;
}

/** Best effort: a changeset that stays open closes itself after an hour of idleness. */
export async function closeChangeset(token: string, changeset: string) {
	await call(`/api/0.6/changeset/${changeset}/close`, { method: "PUT", token }).catch(() => {});
}

/** Null when the API answers its capabilities document, else why it did not. */
export async function probeOsm(): Promise<string | null> {
	try {
		await call("/api/0.6/capabilities.json", { timeout: 3000 });
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}
