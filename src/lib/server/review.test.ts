import { describe, expect, it } from "vitest";
import { decisionOps, type Picks, type Proposal, RefusedError } from "./review";

const P = (
	position: number,
	op: Proposal["op"],
	k: string,
	v: string,
	was: string | null = null,
): Proposal => ({
	id: 100 + position,
	position,
	op,
	k,
	v,
	was,
	ev: true,
	invalid: false,
});

const proposals = [
	P(0, "add", "phone", "+33 1"),
	P(1, "mod", "name", "New", "Old"),
	P(2, "del", "fax", "+33 2"),
];
const unchanged = [
	{ k: "amenity", v: "cafe" },
	{ k: "website", v: "https://a.example" },
];
const none: Picks = { tags: [], set: [], del: [] };

describe("decisionOps", () => {
	it("takes picked proposals as they are", () => {
		expect(decisionOps(proposals, unchanged, { ...none, tags: [0, 2] })).toEqual([
			{ tagId: 100, op: "add", k: "phone", v: "+33 1", was: null },
			{ tagId: 102, op: "del", k: "fax", v: "+33 2", was: null },
		]);
	});

	it("reads add or mod off the object's tags, not off what was posted", () => {
		const ops = decisionOps(proposals, unchanged, {
			...none,
			set: ["phone=+33 9", "name=Mine", "website=https://b.example", "cuisine=coffee_shop"],
		});
		expect(ops).toEqual([
			{ tagId: 100, op: "add", k: "phone", v: "+33 9", was: null },
			{ tagId: 101, op: "mod", k: "name", v: "Mine", was: "Old" },
			{ tagId: null, op: "mod", k: "website", v: "https://b.example", was: "https://a.example" },
			{ tagId: null, op: "add", k: "cuisine", v: "coffee_shop", was: null },
		]);
	});

	it("deletes only a key the object has, with its current value", () => {
		expect(decisionOps(proposals, unchanged, { ...none, del: ["amenity"] })).toEqual([
			{ tagId: null, op: "del", k: "amenity", v: "cafe", was: null },
		]);
		expect(() => decisionOps(proposals, unchanged, { ...none, del: ["cuisine"] })).toThrow(
			RefusedError,
		);
	});

	it("splits on the first = so values may carry one", () => {
		expect(decisionOps([], [], { ...none, set: ["note=a=b"] })[0]).toMatchObject({
			k: "note",
			v: "a=b",
		});
	});

	it("refuses what OSM would or what says nothing", () => {
		const refuse = (picks: Partial<Picks>) =>
			expect(() => decisionOps(proposals, unchanged, { ...none, ...picks })).toThrow(RefusedError);
		refuse({});
		refuse({ set: ["amenity=cafe"] });
		refuse({ set: ["=x"] });
		refuse({ set: ["k="] });
		refuse({ set: [`${"k".repeat(256)}=x`] });
		refuse({ tags: [0], set: ["phone=+33 9"] });
		refuse({ tags: [7] });
		expect(() =>
			decisionOps([{ ...P(0, "add", "phone", "x"), ev: false }], [], { ...none, tags: [0] }),
		).toThrow(RefusedError);
	});
});
