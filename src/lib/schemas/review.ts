import { z } from "zod";

export const acceptSchema = z.object({
	id: z.string().min(1),
	/** Positions of the proposals taken as they are, as the tag rows number them. */
	tags: z.array(z.number().int().min(0)),
	/** The reviewer's own writes, `key=value`; the server decides whether each adds or modifies. */
	set: z.array(z.string()),
	/** Keys the reviewer removes from the object. */
	del: z.array(z.string()),
});

export const candidateSchema = z.object({ id: z.string().min(1) });

export const uploadSchema = z.object({
	comment: z.string().trim().min(1, "A changeset comment is required."),
});

export type UploadForm = z.infer<typeof uploadSchema>;
