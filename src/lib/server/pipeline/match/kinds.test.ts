import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KITS } from "../kits";
import { type Mapping, mappingSchema } from "../mapping/schema";
import { fallbackSummary, validate } from "../mapping/validate";
import { lookalike, lookalikeSelectors, sameKind, selectorsFromTags, shell } from "../tagfilter";
import type { Extraction, OsmElement, ProposedTag } from "../types";
import { contextTags } from "./context";
import { findMatch } from "./find";
import { kinValues, kit, labelKeys, mainKeys, registry, selectorKeys, useMappings } from "./kinds";
import type { Kit, KitFactory } from "./kit";
import { planUpdate } from "./plan";
import { heldWithOthers, indexRefs, refSelectors, siteRefs } from "./refs";
import { matchWarnings, twinWarnings } from "./warnings";

const el = (
	id: number,
	lat: number,
	lon: number,
	tags: Record<string, string> = {},
): OsmElement => ({ type: "node", id, version: 3, lat, lon, tags });

const tag = (k: string, v: string): ProposedTag => ({
	k,
	v,
	conf: 0.9,
	path: "f",
	parts: [{ text: v, mark: true }],
	kind: "dataset row",
});

const record = (over: Partial<Extraction> = {}): Extraction => ({
	key: "a",
	url: "",
	name: "",
	addr: "",
	lat: 45.7,
	lon: 4.8,
	refs: {},
	tags: [],
	...over,
});

const mapping = (id: string, matching: Record<string, unknown>): Mapping =>
	mappingSchema.parse({
		format: 1,
		id,
		language: "cel",
		title: id,
		inputs: { id: "id" },
		record: { key: "id", lat: '"1"', lon: '"2"' },
		matching,
		tags: {},
		examples: [],
	});

afterEach(() => useMappings(null));

describe("the registry the shipped mappings declare", () => {
	it("says what the literals it replaced said", () => {
		expect(mainKeys()).toEqual([
			"amenity",
			"shop",
			"office",
			"tourism",
			"leisure",
			"craft",
			"healthcare",
		]);
		expect(selectorKeys()).toEqual([...mainKeys(), "public_transport"]);
		expect(labelKeys()).toEqual([...mainKeys(), "man_made", "building"]);
		const schools = ["school", "college", "university"];
		for (const v of schools) expect(kinValues("amenity", v)).toEqual(schools);
		expect(kinValues("amenity", "social_facility")).toEqual(["social_facility", "school"]);
		expect(kinValues("amenity", "pharmacy")).toEqual(["pharmacy"]);
		expect(kinValues("shop", "school")).toEqual(["school"]);
		const lookalikes = registry().lookalikes;
		expect(lookalikes.get("amenity=charging_station")).toEqual([
			{ k: "man_made", v: ["charge_point"] },
			{ k: "capacity:charging", v: null },
		]);
		expect(lookalikes.get("amenity=school")).toEqual([{ k: "amenity", v: ["kindergarten"] }]);
		expect(lookalikes.get("amenity=social_facility")).toEqual([
			{ k: "healthcare", v: ["centre"] },
			{ k: "amenity", v: ["clinic"] },
		]);
		expect(refSelectors("ref:UAI")).toEqual([
			{ k: "ref:UAI", v: null },
			{ k: "ref:FR:UAI", v: null },
		]);
		expect(refSelectors("ref:EU:EVSE")).toEqual([
			{ k: "ref:EU:EVSE", v: null, not: { k: "man_made", v: ["charge_point"] } },
		]);
		expect(refSelectors("ref:FR:SIRET")).toEqual([]);
		expect(siteRefs()).toEqual(["ref:EU:EVSE", "ref:UAI"]);
	});

	it("is built on the first call, in a module graph where nothing else was imported", async () => {
		vi.resetModules();
		const fresh = await import("./kinds");
		expect(fresh.mainKeys()).toContain("amenity");
	});

	it("keeps public_transport selecting and blocking a bare building, and lets a new key select only", () => {
		expect(selectorsFromTags([{ k: "public_transport", v: "station" }])).toEqual([
			{ k: "public_transport", v: ["station"] },
		]);
		expect(shell({ building: "school", public_transport: "station" })).toBe(false);
		useMappings([
			...[mapping("XX:thing", { main: ["emergency"] })],
			...[
				mapping("FR:school", {
					main: ["amenity"],
					shell: { k: "building", v: ["school"], of: "amenity" },
				}),
			],
		]);
		expect(mainKeys().at(-1)).toBe("emergency");
		expect(selectorKeys().at(-1)).toBe("emergency");
		expect(selectorsFromTags([{ k: "emergency", v: "defibrillator" }])).toEqual([
			{ k: "emergency", v: ["defibrillator"] },
		]);
		expect(shell({ building: "school", emergency: "defibrillator" })).toBe(true);
	});

	it("takes an unnamed shell for a lookalike of a school, college, university and institute only", () => {
		const bare = { building: "school" };
		for (const v of ["school", "college", "university", "social_facility"])
			expect(lookalike("amenity", v, bare)).toBe(true);
		for (const v of ["kindergarten", "pharmacy", "charging_station"])
			expect(lookalike("amenity", v, bare)).toBe(false);
		expect(lookalike("amenity", "school", { ...bare, name: "École" })).toBe(false);
		expect(lookalikeSelectors([{ k: "amenity", v: "school" }])).toEqual([
			{ k: "amenity", v: ["kindergarten"] },
		]);
	});

	it("lists a reviewer's context in its pinned order", () => {
		const tags = [
			"website",
			"operator",
			"ref:FR:SIRET",
			"school:FR",
			"ref:EU:EVSE",
			"ref:UAI",
			"name",
			"amenity",
			"addr:street",
		].map((k) => ({ k, v: "x" }));
		expect(contextTags(tags).map((t) => t.k)).toEqual([
			"amenity",
			"name",
			"ref:UAI",
			"ref:EU:EVSE",
			"ref:FR:SIRET",
			"school:FR",
		]);
	});
});

describe("the kit a record answers to", () => {
	it("is its own kind's, else the one kit defining the method, as the code it replaced ran for any record", () => {
		expect(kit({}, "fit")).toBeDefined();
		expect(kit({ kind: "FR:school" }, "fit")).toBe(kit({}, "fit"));
		expect(kit({ kind: "FR:charging_station" }, "pick")).toBe(kit({}, "pick"));
		expect(kit({ kind: "XX:nothing" }, "counts")).toBe(kit({}, "counts"));
	});

	it("gives a record with no kind and a capacity the station fit and its score", () => {
		const fitOf = kit({}, "fit");
		const x = record({ tags: [tag("capacity", "4")] });
		expect(fitOf?.(x, el(1, 45.7, 4.8, { capacity: "4" }))).toMatchObject({
			agree: 1,
			against: 0,
			score: 1,
		});
		expect(fitOf?.(x, el(2, 45.7, 4.8, { capacity: "2" }))).toMatchObject({
			against: 1,
			score: -1,
		});
	});

	it("tells one borne from another's only against the object a record is matched to", () => {
		const own = (id: number, ref: string) =>
			el(id, 43.6, 1.4, { amenity: "charging_station", ref });
		const [a, b] = [own(1, "BRN06A"), own(2, "BRN07A")];
		const excludes = kit({}, "excludes");
		const x = record();
		expect(excludes?.(x, b, a)).toBe(true);
		expect(excludes?.(x, b)).toBe(false);
	});

	it("leaves a station beside a node named as a campus undated, and passes over an unnamed school building", () => {
		const station = record({
			kind: "FR:charging_station",
			name: "Parking",
			tags: [tag("amenity", "charging_station"), tag("start_date", "2020-01-01")],
		});
		const campus = el(1, 45.7, 4.8, {
			amenity: "charging_station",
			name: "Parking École Collège Lycée",
		});
		expect(planUpdate(station, campus, [campus]).ops.map((o) => o.k)).not.toContain("start_date");
		const building = el(2, 45.7, 4.8, { building: "school" });
		expect(findMatch(station, [building], indexRefs([building], []))).toBeNull();
	});

	it("keeps the start_date on an object carrying the record's UAI and another school's mailbox", () => {
		const x = record({
			kind: "FR:school",
			refs: { "ref:UAI": "0690001A" },
			tags: [tag("amenity", "school"), tag("start_date", "1990-01-01")],
		});
		const mailbox = el(1, 45.7, 4.8, {
			amenity: "school",
			"ref:UAI": "0690001A",
			email: "ce.0690002B@ac-lyon.fr",
		});
		expect(heldWithOthers(mailbox, x.refs)).toBe(false);
		expect(planUpdate(x, mailbox, [mailbox]).ops.map((o) => o.k)).toContain("start_date");
		const both = el(2, 45.7, 4.8, { amenity: "school", "ref:UAI": "0690001A;0690002B" });
		expect(heldWithOthers(both, x.refs)).toBe(true);
		expect(planUpdate(x, both, [both]).ops.map((o) => o.k)).not.toContain("start_date");
	});

	it("counts a site without the objects carrying its id farther off", () => {
		const x = record({
			kind: "FR:school",
			name: "École Jules Ferry",
			refs: { "ref:UAI": "0690001A" },
			tags: [tag("amenity", "school")],
		});
		const matched = el(1, 45.7, 4.8, { amenity: "school", "ref:UAI": "0690001A" });
		const beside = el(2, 45.70005, 4.8, { amenity: "school" });
		const far = el(3, 45.72, 4.8, { amenity: "school", "ref:UAI": "0690001A" });
		const els = [matched, beside, far];
		const lines = matchWarnings(x, matched, els, indexRefs(els, ["ref:UAI"]), new Set());
		expect(
			lines.filter((l) => l.startsWith("Same site may be mapped as 2 objects (also node/2")),
		).toHaveLength(1);
		expect(
			lines.find((l) => l.startsWith("Another object carrying this UAI is node/3")),
		).toBeDefined();
	});
});

describe("two records of the run", () => {
	const near = (key: string, over: Partial<Extraction>) =>
		record({
			key,
			name: "Pôle recharge",
			lat: 45.7 + (key === "b" ? 0.00027 : 0),
			tags: [tag("operator", "Alpha")],
			...over,
		});

	it("are twins 30 m apart only when no hard ref says they are two places", () => {
		const stations = [near("a", {}), near("b", {})];
		expect([...twinWarnings(stations).keys()].sort()).toEqual(["a", "b"]);
		const schools = [
			near("a", { refs: { "ref:UAI": "0690001A" } }),
			near("b", { refs: { "ref:UAI": "0690002B" } }),
		];
		expect(twinWarnings(schools).size).toBe(0);
	});
});

const stub =
	(m: Partial<Kit>): KitFactory =>
	() =>
		m;

describe("a kind with a block and no kit", () => {
	const thing = (extra: Record<string, unknown> = {}) =>
		mapping("XX:thing", {
			main: ["amenity"],
			lookalikes: { "amenity=thing": [{ k: "amenity", v: ["thang"] }] },
			refs: { "ref:XX": { rules_out: "hard", site: true } },
			...extra,
		});

	it("finds, matches by id, rules out another's id and warns of a namesake, with the engine's defaults", () => {
		useMappings([thing()], {});
		const x = record({
			name: "Alpha Beta Gamma Delta Epsilon Zeta",
			refs: { "ref:XX": "1" },
			tags: [tag("amenity", "thing")],
		});
		const mine = el(1, 45.7, 4.8, {
			amenity: "thing",
			"ref:XX": "1",
			name: "Alpha Beta Gamma Delta Epsilon Zeta",
		});
		const other = el(2, 45.7, 4.8, { amenity: "thing", "ref:XX": "2" });
		const els = [other, mine];
		const idx = indexRefs(els, ["ref:XX"]);
		expect(findMatch(x, els, idx)).toBe(mine);
		expect(
			findMatch({ ...x, refs: { "ref:XX": "3" } }, [other], indexRefs([other], ["ref:XX"])),
		).toBeNull();
		const twin = el(3, 45.7006, 4.8, {
			amenity: "thing",
			name: "Alpha Beta Gamma Delta Epsilon Zetas",
		});
		const lines = matchWarnings(x, mine, [...els, twin], idx, new Set());
		expect(
			lines.some((l) =>
				l.startsWith("Possible duplicate of this object: amenity=thing is also mapped at node/3"),
			),
		).toBe(true);
		expect(selectorsFromTags([{ k: "amenity", v: "thing" }])).toEqual([
			{ k: "amenity", v: ["thing"] },
		]);
		expect(sameKind("amenity", "thing", { amenity: "thing" })).toBe(true);
		expect(
			matchWarnings(
				record({ tags: [tag("amenity", "thing")] }),
				null,
				[el(4, 45.7, 4.8, { amenity: "thang" })],
				new Map(),
				new Set(),
			),
		).toHaveLength(1);
	});

	it("shows which kinds a method reaches by fallback, and none once a second kit defines it", () => {
		const a = mapping("XX:alpha", { main: ["amenity"], kit: "xx.alpha" });
		const b = mapping("XX:beta", { main: ["amenity"], kit: "xx.beta" });
		const c = mapping("XX:gamma", { main: ["amenity"] });
		const pick = stub({ pick: () => null });
		expect(fallbackSummary([a, b, c], { "xx.alpha": pick, "xx.beta": stub({}) })).toBe(
			"pick (xx.alpha) -> XX:beta, XX:gamma",
		);
		expect(fallbackSummary([a, b, c], { "xx.alpha": pick, "xx.beta": pick })).toBe(
			"pick: defined by xx.alpha and xx.beta, so no fallback",
		);
		expect(fallbackSummary([a, c], KITS)).toBe("");
	});
});

describe("validate over a block", () => {
	const yaml = (
		matching: string,
		tags = "  amenity: { value: '\"pharmacy\"', conf: 0.9, quote: [id] }\n  ref:XX: { value: id, conf: 0.9, ref: true }",
	) => `format: 1
id: XX:pharmacy
language: cel
title: Pharmacies
inputs: { id: its id }
record: { key: id, lat: '"1"', lon: '"2"' }
matching:
${matching}
tags:
${tags}
examples:
  - { about: one, rows: [{ id: A }], expect: { amenity: pharmacy, ref:XX: A } }
`;
	const problemsOf = (text: string, kits: Record<string, KitFactory> = {}, second?: string) => {
		const root = mkdtempSync(join(tmpdir(), "matching-"));
		const files: Record<string, string> = { "mappings/xx/pharmacy.yaml": text };
		if (second) files["mappings/xx/clinic.yaml"] = second;
		for (const [name, body] of Object.entries(files)) {
			mkdirSync(dirname(join(root, name)), { recursive: true });
			writeFileSync(join(root, name), body);
		}
		return validate(root, kits).flatMap((r) => r.problems);
	};

	it("passes a block with a hard ref and no kit", () => {
		expect(
			problemsOf(
				yaml(
					"  main: [amenity]\n  kin: { amenity=pharmacy: [pharmacy, chemist] }\n  refs: { ref:XX: { rules_out: hard, site: true } }",
				),
			),
		).toEqual([]);
	});

	it("refuses what each rule of the block forbids", () => {
		const bad = (matching: string, kits?: Record<string, KitFactory>) =>
			problemsOf(yaml(matching), kits).join("\n");
		expect(bad("  main: []")).toContain("matching.main: names no key");
		expect(bad("  main: [shop]")).toContain("matching.main: shop is not written by any tag");
		expect(bad("  main: [amenity]\n  shell: { k: building, v: [x], of: shop }")).toContain(
			"matching.shell.of: shop is not among main",
		);
		expect(bad("  main: [amenity]\n  refs: { amenity: { site: true } }")).toContain(
			"matching.refs.amenity: is not a tag with ref: true",
		);
		expect(bad("  main: [amenity]\n  kit: xx.pharmacy")).toContain(
			"matching.kit: xx.pharmacy is not registered in kits.ts",
		);
		expect(bad("  main: [amenity]\n  kit: xx.other", { "xx.other": stub({}) })).toContain(
			"matching.kit: xx.other is scoped to another kind of place",
		);
		expect(bad("  main: [amenity]\n  kit: fr.pharmacy", { "fr.pharmacy": stub({}) })).toContain(
			"matching.kit: fr.pharmacy is scoped to another country",
		);
		expect(
			bad("  main: [amenity]\n  kit: xx.pharmacy", {
				"xx.pharmacy": stub({ accepts: { "amenity=a": () => true } }),
			}),
		).toContain(
			"matching.kit: xx.pharmacy has accepts amenity=a, which the block does not declare",
		);
	});

	it("refuses a pair or a ref two files declare differently, and a hook two kits define", () => {
		const first = yaml("  main: [amenity]\n  refs: { ref:XX: { rules_out: hard } }");
		const second = first
			.replace("XX:pharmacy", "XX:clinic")
			.replace("rules_out: hard", "rules_out: soft");
		expect(problemsOf(first, {}, second).join("\n")).toContain(
			"matching.refs.ref:XX: XX:pharmacy and XX:clinic declare it differently",
		);
		const withKits = (name: string) =>
			yaml(`  main: [amenity]\n  kit: xx.${name}\n  kin: { amenity=a: [a, b] }`);
		const hook = stub({ accepts: { "amenity=a": () => true } });
		expect(
			problemsOf(
				withKits("pharmacy"),
				{ "xx.pharmacy": hook, "xx.clinic": hook },
				withKits("clinic").replace("XX:pharmacy", "XX:clinic"),
			).join("\n"),
		).toContain("kits xx.clinic and xx.pharmacy both define accepts amenity=a");
	});
});
