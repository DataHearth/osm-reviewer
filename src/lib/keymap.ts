/** The rebindable actions, in the order the shortcuts pane lists them. +layout.svelte implements them. */
export const ACTIONS = {
	down: { scope: "queue", key: "j", does: "move selection down" },
	up: { scope: "queue", key: "k", does: "move selection up" },
	open: { scope: "queue", key: "Enter", does: "open the selected candidate" },
	prevPage: { scope: "queue", key: "h", does: "previous page" },
	nextPage: { scope: "queue", key: "l", does: "next page" },
	accept: { scope: "review", key: "a", does: "accept the selected tags" },
	reject: { scope: "review", key: "r", does: "reject the candidate" },
	skip: { scope: "review", key: "x", does: "skip to the next candidate" },
	prev: { scope: "review", key: "h", does: "previous candidate" },
	next: { scope: "review", key: "l", does: "next candidate" },
	upload: { scope: "composer", key: "Enter", does: "upload the changeset" },
	undo: { scope: "global", key: "u", does: "undo the last decision" },
	back: { scope: "global", key: "Escape", does: "back to the queue" },
} as const;

export type Action = keyof typeof ACTIONS;
export type Bindings = Record<Action, string>;

export const ACTION_IDS = Object.keys(ACTIONS) as Action[];

/**
 * Handled outside the bindings: the arrows always move — rows and pages on the queue,
 * candidates on review — and 1–9 toggle tags on review.
 */
export const RESERVED = /^([1-9]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/;

/** Pressing these alone never makes a binding. Tab stays focus navigation. */
export const UNBINDABLE = /^(Shift|Control|Alt|Meta|AltGraph|CapsLock|Tab|Dead|Unidentified)$/;

export const DEFAULT_BINDINGS = Object.fromEntries(
	ACTION_IDS.map((a) => [a, ACTIONS[a].key]),
) as Bindings;

/** Stored bindings over the defaults, so an action added later still gets its key. */
export const resolveBindings = (stored: Partial<Bindings> | null | undefined): Bindings => ({
	...DEFAULT_BINDINGS,
	...stored,
});

const overlap = (a: Action, b: Action) => {
	const sa = ACTIONS[a].scope;
	const sb = ACTIONS[b].scope;
	return sa === "global" || sb === "global" || sa === sb;
};

/** The actions sharing a key with another action that can fire on the same screen. */
export function clashes(b: Bindings): Action[] {
	return ACTION_IDS.filter((a) =>
		ACTION_IDS.some((o) => o !== a && b[o] === b[a] && overlap(a, o)),
	);
}

/** The on-screen hint spelling: `J`, `Enter`, `Esc`. */
export const kbdLabel = (k: string) => {
	const l = keyLabel(k);
	return l.length === 1 ? l.toUpperCase() : l[0].toUpperCase() + l.slice(1);
};

export const keyLabel = (k: string) =>
	k === " " ? "space" : k === "Escape" ? "esc" : k.length === 1 ? k : k.toLowerCase();
