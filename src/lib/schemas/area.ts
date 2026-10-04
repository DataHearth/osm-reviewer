import { z } from "zod";

const relSchema = z.object({
	rel: z.string(),
	name: z.string(),
	displayName: z.string(),
	level: z.number().int().nullable(),
	center: z.tuple([z.number(), z.number()]),
	bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
	km: z.number(),
	sqkm: z.number(),
});

export const areaDraftSchema = z
	.object({
		editId: z.string().nullable().default(null),
		name: z.string().trim().default(""),
		mode: z.enum(["relation", "radius"]).default("relation"),
		query: z.string().default(""),
		picked: relSchema.nullable().default(null),
		center: z
			.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
			.default([43.6045, 1.444]),
		radius: z.number().int().min(250).max(8000).default(2500),
		srcs: z.record(z.string(), z.boolean()).default({}),
	})
	.refine((d) => d.mode === "radius" || d.picked !== null, {
		path: ["picked"],
		message: "Pick a relation, or switch to a radius.",
	})
	.refine((d) => d.mode === "relation" || d.name.length > 0, {
		path: ["name"],
		message: "A radius area needs a name.",
	});

export type AreaDraft = z.infer<typeof areaDraftSchema>;

export const areaIdSchema = z.object({ id: z.string().min(1) });

export const areaPausedSchema = z.object({
	id: z.string().min(1),
	paused: z.boolean(),
});
