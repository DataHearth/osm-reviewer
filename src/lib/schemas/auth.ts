import { z } from "zod";

/** Wrong passwords allowed before sign-in locks; the login screen quotes this. */
export const MAX_TRIES = 5;
export const LOCKOUT_MINUTES = 15;

/** How long a session lives without use; the login screen quotes this too. */
export const SESSION_DAYS = 180;

export const loginSchema = z.object({
	email: z.string().trim().min(1, "Enter the email address for your account."),
	password: z.string().min(1, "Enter your password."),
	/** The guarded path that bounced the visitor here; validated server-side before use. */
	redirectTo: z.string().default("/"),
});

/**
 * The login screen has one error line for the whole form, so everything the
 * server wants to say about an attempt travels as a single status message.
 * `locked` is what raises the lockout banner and disables the fields.
 */
export type LoginMessage = { text: string; tone: "bad" | "warn"; locked?: boolean };
