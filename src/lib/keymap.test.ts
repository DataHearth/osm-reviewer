import { describe, expect, it } from "vitest";
import { clashes, DEFAULT_BINDINGS, resolveBindings } from "./keymap";
import { keysSchema } from "./schemas/settings";

const flags = { vim: true, confirmAccept: false, showHints: true };

describe("key bindings", () => {
	it("defaults clash nowhere, though open and upload share enter on different screens", () => {
		expect(clashes(DEFAULT_BINDINGS)).toEqual([]);
	});

	it("a key on a global action clashes with every screen", () => {
		expect(clashes({ ...DEFAULT_BINDINGS, upload: "u" })).toEqual(["upload", "undo"]);
	});

	it("the queue's j/k clash with review keys, since review steps with them too", () => {
		expect(clashes({ ...DEFAULT_BINDINGS, accept: "j" })).toEqual(["down", "accept"]);
	});

	it("stored bindings sit over the defaults", () => {
		expect(resolveBindings({ accept: "y" })).toEqual({ ...DEFAULT_BINDINGS, accept: "y" });
	});

	it("the schema refuses clashes and reserved keys", () => {
		expect(keysSchema.safeParse({ ...flags, bindings: DEFAULT_BINDINGS }).success).toBe(true);
		expect(
			keysSchema.safeParse({ ...flags, bindings: { ...DEFAULT_BINDINGS, reject: "a" } }).success,
		).toBe(false);
		expect(
			keysSchema.safeParse({ ...flags, bindings: { ...DEFAULT_BINDINGS, reject: "3" } }).success,
		).toBe(false);
	});
});
