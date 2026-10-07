import { z } from "zod";

export const SOURCE_KINDS = ["registry", "crawl", "api"] as const;
export const EXTRACTORS = ["deterministic", "model"] as const;
export const SCHEDULES = ["every 12 h", "daily", "weekly", "monthly"] as const;

/** The endpoint's label changes with the kind, and so does the message a missing one gets. */
export const EP_LABEL: Record<(typeof SOURCE_KINDS)[number], string> = {
	registry: "dataset file",
	crawl: "seed rule",
	api: "endpoint",
};

export const sourceDraftSchema = z.object({
	editId: z.string().nullable().default(null),
	name: z.string().trim().min(1, "A name is required."),
	kind: z.enum(SOURCE_KINDS).default("api"),
	endpoint: z.string().trim().min(1, "Required."),
	key: z.string().default(""),
	schedule: z.enum(SCHEDULES).default("weekly"),
	floor: z.number().min(0).max(0.9).default(0.6),
	/** The chip editor's committed keys. The half-typed chip is component state, not data. */
	allow: z.array(z.string().trim().min(1)).default([]),
	matching: z.string().default(""),
	budget: z.string().default(""),
	extractor: z.enum(EXTRACTORS).default("deterministic"),
	/** A mapping id such as `FR:school`, or null to detect the preset from the columns. */
	preset: z.string().nullable().default(null),
	areas: z.record(z.string(), z.boolean()).default({}),
});

export type SourceDraft = z.infer<typeof sourceDraftSchema>;

export const sourceEnabledSchema = z.object({
	id: z.string().min(1),
	enabled: z.boolean(),
});

export const sourceIdSchema = z.object({ id: z.string().min(1) });

/** Switching on a shipped source: the file's id such as `fr/irve`, and the areas to read it for. */
export const officialAddSchema = z.object({
	file: z.string().min(1),
	areas: z.record(z.string(), z.boolean()).default({}),
});

export type OfficialAdd = z.infer<typeof officialAddSchema>;
