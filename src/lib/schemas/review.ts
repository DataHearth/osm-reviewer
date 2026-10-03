import { z } from "zod";

export const acceptSchema = z.object({
	id: z.string().min(1),
	/** Positions of the selected tags, as the tag rows number them. */
	tags: z.array(z.number().int().min(0)).min(1, "nothing selected — no tags would be written."),
});

export const candidateSchema = z.object({ id: z.string().min(1) });

export const uploadSchema = z.object({
	comment: z.string().trim().min(1, "A changeset comment is required."),
	source: z.string().trim().min(1, "A source tag is required."),
});

export type UploadForm = z.infer<typeof uploadSchema>;
