import { describe, expect, it } from "vitest";
import { applyOps, changesetXml, esc, type OsmElement, osmChange } from "./osmchange";

const node: OsmElement = {
	type: "node",
	id: 5,
	version: 3,
	lat: 43.6,
	lon: 1.44,
	tags: { amenity: "pharmacy", name: "A & B", phone: "x" },
};

describe("esc", () => {
	it("escapes markup and whitespace that attributes cannot hold raw", () => {
		expect(esc(`a&b<c>"d"'e'\nf`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;&#10;f");
	});
});

describe("applyOps", () => {
	it("sets, replaces and removes, keeping untouched tags", () => {
		const out = applyOps(
			node.tags,
			[
				{ op: "add", k: "website", v: "https://x" },
				{ op: "mod", k: "phone", v: "y" },
				{ op: "del", k: "name", v: "" },
			],
			false,
		);
		expect(out).toEqual({ amenity: "pharmacy", phone: "y", website: "https://x" });
	});

	it("drops the bare key a disused: tag replaces, on closures only", () => {
		const ops = [{ op: "mod" as const, k: "disused:amenity", v: "pharmacy" }];
		expect(applyOps(node.tags, ops, true).amenity).toBeUndefined();
		expect(applyOps(node.tags, ops, false).amenity).toBe("pharmacy");
	});
});

describe("osmChange", () => {
	it("writes the current element with its version and escaped tags", () => {
		const xml = osmChange(
			[
				{
					kind: "modify",
					element: node,
					ops: [{ op: "add", k: "note", v: 'say "hi"' }],
					closure: false,
				},
			],
			"77",
			"osm-reviewer/1",
		);
		expect(xml).toContain("<modify>");
		expect(xml).toContain('<node id="5" version="3" changeset="77" lat="43.6" lon="1.44">');
		expect(xml).toContain('<tag k="name" v="A &amp; B"/>');
		expect(xml).toContain('<tag k="note" v="say &quot;hi&quot;"/>');
	});

	it("emits ways with their nodes and creates with negative ids", () => {
		const way: OsmElement = { type: "way", id: 9, version: 1, nodes: [1, 2], tags: {} };
		const xml = osmChange(
			[
				{ kind: "modify", element: way, ops: [{ op: "add", k: "a", v: "b" }], closure: false },
				{
					kind: "create",
					placeholder: -1,
					lat: 1,
					lon: 2,
					ops: [{ op: "add", k: "shop", v: "bakery" }],
				},
			],
			"1",
			"g",
		);
		expect(xml).toContain('<nd ref="2"/>');
		expect(xml).toContain('<node id="-1"');
		expect(xml.indexOf("<create>")).toBeLessThan(xml.indexOf("<modify>"));
	});
});

describe("changesetXml", () => {
	it("carries created_by", () => {
		expect(changesetXml({ comment: "a<b" }, "g/1")).toContain('<tag k="created_by" v="g/1"/>');
	});
});
