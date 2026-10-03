/** The rebindable actions, in the order the shortcuts pane lists them. +layout.svelte implements them. */
export const ACTIONS = {
	down: { scope: "queue", key: "j", does: "move selection down" },
	up: { scope: "queue", key: "k", does: "move selection up" },
	open: { scope: "queue", key: "Enter", does: "open the selected candidate" },
	accept: { scope: "review", key: "a", does: "accept the selected tags" },
	reject: { scope: "review", key: "r", does: "reject the candidate" },
	skip: { scope: "review", key: "x", does: "skip to the next candidate" },
	upload: { scope: "composer", key: "Enter", does: "upload the changeset" },
	undo: { scope: "global", key: "u", does: "undo the last decision" },
	back: { scope: "global", key: "Escape", does: "back to the queue" },
} as const;

export type Action = keyof typeof ACTIONS;
export type Bindings = Record<Action, string>;

export const ACTION_IDS = Object.keys(ACTIONS) as Action[];

/** Handled outside the bindings: the arrows always move the queue, 1–9 toggle tags on review. */
export const RESERVED = /^([1-9]|ArrowUp|ArrowDown)$/;

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

// j/k also step through candidates on the review screen, so the queue's
// movement keys are live there too.
const screens = (a: Action): string[] => {
	const s = ACTIONS[a].scope;
	return a === "down" || a === "up" ? [s, "review"] : [s];
};

const overlap = (a: Action, b: Action) => {
	const sa = screens(a);
	const sb = screens(b);
	return sa.includes("global") || sb.includes("global") || sa.some((s) => sb.includes(s));
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
