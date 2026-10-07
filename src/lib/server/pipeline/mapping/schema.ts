import { z } from "zod";
import { SCHEDULES, SOURCE_KINDS } from "$lib/schemas/source";

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
	/** The tag's value is an identifier OSM may already carry, matched before any distance is looked at. */
	ref: z.boolean().optional(),
	/** The inputs the evidence shows where they are not the ones the rule reads. */
	quote: z.array(name).min(1).optional(),
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
		/** The line the country's address base is asked for; empty where the record has none. */
		address: z.string().optional(),
		/** How far the point may sit from its own housenumber before the address is taken over it: metres, or a rule giving them (0 or less never moves it). */
		farM: z.union([z.number().positive(), z.string()]).optional(),
		/** Farther than this from a housenumber in the record's postcode, the point is an error however precisely it is written. */
		wrongM: z.number().positive().optional(),
		/** For a key the source lists at several sites, the row whose address the base places nearest its point is the record. */
		pick: z.literal("nearest").optional(),
		/** The input whose shortest value wins among rows `pick` finds equally near. */
		tieBreak: name.optional(),
		/** Inputs holding a phone number or a mailbox that a record leaves out are counted, for the run's message. */
		withheld: z.array(name).min(1).optional(),
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

const httpsUrl = z.url({ protocol: /^https$/ });

/**
 * What makes a shipped source official, and what a `sources` row needs to be made from it.
 * The checklist is the design's: published by the organisation that runs or regulates the
 * places, under a licence OSM can use, at a stable address.
 */
export const officialSchema = z.strictObject({
	title: z.string().min(1),
	publisher: z.strictObject({ name: z.string().min(1), relation: z.string().min(1) }),
	licence: z.string().min(1),
	/** The dataset's own page, which a person can open to check the other two. */
	address: httpsUrl,
	/** The OSM community's pages and threads on using this dataset. */
	discussion: z.array(httpsUrl).min(1),
	source: z.strictObject({
		kind: z.enum(SOURCE_KINDS),
		endpoint: httpsUrl,
		/** Addresses the dataset answered at before; a row made from the file under one still counts as official. */
		formerEndpoints: z.array(httpsUrl).optional(),
		schedule: z.enum(SCHEDULES),
		matching: z.string().min(1),
		floor: z.number().min(0).max(0.9),
		allow: z.array(z.string().min(1)).min(1),
	}),
});

export const renamingSchema = z.strictObject({
	format: z.literal(1),
	source: z.string().regex(/^[a-z]{2}\/[a-z0-9-]+$/, "country/source, e.g. fr/irve"),
	mapping: z.string(),
	official: officialSchema.optional(),
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
export type Official = z.infer<typeof officialSchema>;
export type Renaming = z.infer<typeof renamingSchema>;
export type OfficialRenaming = Renaming & { official: Official };
