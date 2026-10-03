import type { KeyRow } from "./types";

/** Mirrors the handler in src/routes/+layout.svelte. */
export const KEYMAP: KeyRow[] = [
	["queue", "j / k", "move selection down / up"],
	["queue", "enter", "open the selected candidate"],
	["review", "a", "accept the selected tags"],
	["review", "r", "reject the candidate"],
	["review", "x", "skip to the next candidate"],
	["review", "1 – 9", "toggle tag n"],
	["composer", "enter", "upload the changeset"],
	["global", "u", "undo the last decision"],
	["global", "esc", "back to the queue"],
];
