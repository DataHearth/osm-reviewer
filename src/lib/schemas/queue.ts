import { z } from "zod";

export const SORT_KEYS = ["type", "name", "tags", "source", "age", "flags", "conf"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

/** Words read A to Z first; counts, age, flags and confidence read biggest first. */
export const defaultDir = (k: SortKey): SortDir =>
	k === "type" || k === "name" || k === "source" ? "asc" : "desc";

/**
 * The queue's view as the URL carries it. A hand-edited or stale link is still a
 * link to the queue, so a value that does not parse falls back to its default
 * rather than answering 400.
 */
export const queueQuerySchema = z
	.object({
		type: z.enum(["all", "new", "update", "closure"]).catch("all"),
		conf: z.enum(["all", "high", "mid", "low"]).catch("all"),
		sort: z.enum(SORT_KEYS).catch("type"),
		dir: z.enum(["asc", "desc"]).optional().catch(undefined),
		page: z.coerce.number().int().min(1).catch(1),
	})
	.transform((q) => ({ ...q, dir: q.dir ?? defaultDir(q.sort) }));

export type QueueQuery = z.output<typeof queueQuerySchema>;

export const parseQueueQuery = (params: URLSearchParams): QueueQuery =>
	queueQuerySchema.parse(Object.fromEntries(params));

export const DEFAULT_QUERY: QueueQuery = queueQuerySchema.parse({});

/** The search string for a view, without its defaults, so the plain view stays a plain `/`. */
export function queueSearch(q: QueueQuery): string {
	const p = new URLSearchParams();
	if (q.type !== "all") p.set("type", q.type);
	if (q.conf !== "all") p.set("conf", q.conf);
	if (q.sort !== "type") p.set("sort", q.sort);
	if (q.dir !== defaultDir(q.sort)) p.set("dir", q.dir);
	if (q.page !== 1) p.set("page", String(q.page));
	return p.toString();
}

export const queueHref = (path: string, q: QueueQuery) => {
	const s = queueSearch(q);
	return s ? `${path}?${s}` : path;
};
