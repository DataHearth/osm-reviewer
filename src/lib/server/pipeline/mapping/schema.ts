import { z } from "zod";

const name = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower-case letters, digits and underscores");

const functionName = z
	.string()
	.regex(/^[a-z]+(\.[a-z_-]+)?\/[A-Za-z0-9]+$/, "scope/name, e.g. fr.school/name");

/** A number, or a rule giving one where how far the source is trusted depends on the record. */
const conf = z.union([z.number().gt(0).lte(1), z.string()]);

/** `true` and `false` written bare in YAML are OSM's `yes` and `no`. */
const osmValue = z.union([z.string(), z.number(), z.boolean()]).transform((v) => {
	if (v === true) return "yes";
	if (v === false) return "no";
	return String(v);
});

const common = {
	conf,
	fill: z.union([z.boolean(), z.string()]).optional(),
	rule: z.string().optional(),
	unless: z.strictObject({ key: z.string(), value: z.string() }).optional(),
	mappedWithin: z.number().int().positive().optional(),
	group: z.string().optional(),
};

const expressionTag = z.strictObject({ value: z.string(), ...common });
const functionTag = z.strictObject({
	function: functionName,
	reads: z.array(name).min(1),
	...common,
});
export const tagSchema = z.union([expressionTag, functionTag]);

const example = z.strictObject({
	about: z.string(),
	rows: z.array(z.record(z.string(), z.string())).min(1),
	expect: z.record(z.string(), osmValue).nullable(),
	notes: z.array(z.string()).optional(),
});

export const mappingSchema = z.strictObject({
	format: z.literal(1),
	id: z.string().regex(/^[A-Z]{2}:[a-z_]+$/, "COUNTRY:kind, e.g. FR:school"),
	language: z.literal("cel"),
	title: z.string(),
	inputs: z.record(
		name.refine((n) => n !== "type", "type is reserved"),
		z.string(),
	),
	record: z.strictObject({
		key: z.string(),
		groupBy: z.string().optional(),
		lat: z.string(),
		lon: z.string(),
		skip: z.string().optional(),
		closed: z.string().optional(),
	}),
	let: z
		.record(
			z.string().regex(/^[a-z][A-Za-z0-9_]*$/, "a CEL identifier starting lower-case"),
			z.string(),
		)
		.optional(),
	tags: z.record(z.string(), tagSchema),
	notes: z.array(z.strictObject({ when: z.string(), text: z.string() })).optional(),
	examples: z.array(example),
});

export const renamingSchema = z.strictObject({
	format: z.literal(1),
	source: z.string().regex(/^[a-z]{2}\/[a-z0-9-]+$/, "country/source, e.g. fr/irve"),
	mapping: z.string(),
	columns: z.array(z.string()).min(1),
	rename: z.record(z.string(), name),
	ignored: z.record(z.string(), z.string()).optional(),
	overrides: z
		.strictObject({
			tags: z.record(z.string(), z.union([z.null(), z.record(z.string(), z.unknown())])),
		})
		.optional(),
	steps: z
		.array(
			z.strictObject({
				name: functionName,
				why: z.string(),
				reads: z.array(z.string()).min(1),
			}),
		)
		.optional(),
	examples: z
		.array(
			z.strictObject({
				about: z.string(),
				rows: z.array(z.record(z.string(), z.string())).min(1),
				expect: z.record(z.string(), osmValue).nullable(),
				notes: z.array(z.string()).optional(),
			}),
		)
		.optional(),
});

export type Tag = z.infer<typeof tagSchema>;
export type Example = z.infer<typeof example>;
export type Mapping = z.infer<typeof mappingSchema>;
export type Renaming = z.infer<typeof renamingSchema>;
