import { z } from "zod";

export const UPLOAD_TARGETS = ["openstreetmap.org", "master.apis.dev.openstreetmap.org"] as const;

export const accountSchema = z.object({
	name: z.string().trim().min(1, "A display name is required."),
	email: z.email("Not an email address."),
});

export const passwordSchema = z
	.object({
		cur: z.string().min(1, "Fill in both the current and the new password."),
		next: z.string().min(10, "New password must be at least 10 characters."),
		again: z.string(),
	})
	.refine((d) => d.next === d.again, {
		path: ["again"],
		message: "The two new passwords do not match.",
	});

export const osmSchema = z.object({
	target: z.enum(UPLOAD_TARGETS),
	comment: z.string().trim().min(1, "Every changeset needs a comment."),
	sourceTag: z.string().trim(),
	hashtag: z.string().trim(),
	perChangeset: z.number().int().min(1).max(500),
});

export const notifSchema = z
	.object({
		ntfy: z.object({ on: z.boolean(), server: z.string().trim(), topic: z.string().trim() }),
		webhook: z.object({ on: z.boolean(), url: z.string().trim(), secret: z.string() }),
		email: z.object({ on: z.boolean(), to: z.string().trim(), relay: z.string().trim() }),
		queueOver: z.number().int().min(10).max(2000),
		events: z.object({
			queue: z.boolean(),
			sourceFailed: z.boolean(),
			uploadFailed: z.boolean(),
			runFinished: z.boolean(),
		}),
	})
	// A channel that is on but unaddressed drops its notifications silently, so the
	// address is required exactly while the channel is.
	.refine((d) => !d.ntfy.on || d.ntfy.topic.length > 0, {
		path: ["ntfy", "topic"],
		message: "A topic is required while ntfy is on.",
	})
	.refine((d) => !d.webhook.on || /^https?:\/\/\S+$/.test(d.webhook.url), {
		path: ["webhook", "url"],
		message: "A http(s) URL is required while the webhook is on.",
	})
	.refine((d) => !d.email.on || z.email().safeParse(d.email.to).success, {
		path: ["email", "to"],
		message: "A recipient address is required while email is on.",
	});

export const keysSchema = z.object({
	vim: z.boolean(),
	confirmAccept: z.boolean(),
	showHints: z.boolean(),
});

export const ROLES = ["admin", "reviewer"] as const;

export const newUserSchema = z.object({
	name: z.string().trim().min(1, "A display name is required."),
	email: z.email("Not an email address."),
	role: z.enum(ROLES).default("reviewer"),
	/** Empty makes the account SSO-only; the server refuses that while SSO is off. */
	password: z
		.string()
		.refine((p) => p === "" || p.length >= 10, "A password needs at least 10 characters."),
});

export const userRoleSchema = z.object({ id: z.string().min(1), role: z.enum(ROLES) });
export const userDisabledSchema = z.object({ id: z.string().min(1), disabled: z.boolean() });
export const userIdSchema = z.object({ id: z.string().min(1) });

export type AccountForm = z.infer<typeof accountSchema>;
export type OsmForm = z.infer<typeof osmSchema>;
export type NotifForm = z.infer<typeof notifSchema>;
export type KeysForm = z.infer<typeof keysSchema>;
export type NewUserForm = z.infer<typeof newUserSchema>;
