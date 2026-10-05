import type { Answer } from "../mapping/evaluate";
import { has, type In, pointIn, type Site } from "./irve-site";

/** What `socket_other` covers: every connector the schema has no column of its own for. */
const OTHER_SOCKETS = [
	"socket:type1",
	"socket:type1_combo",
	"socket:type3",
	"socket:type3a",
	"socket:type3c",
];

/**
 * What a connector can physically deliver: AC type 2 at 63 A three-phase, a domestic socket at
 * 16 A. Some operators declare a DC unit's power on its AC outlet too (150 kW on a type 2), and
 * one declares its type 2 points as domestic sockets at 7 kW; no output is better than those.
 * Above 400 kW a DC power is a cabinet's or a site's total (RAIDEN's 1242 and 1500 kW), or
 * watts (50000).
 */
const MAX_KW: Record<string, number> = {
	"socket:type2": 43.5,
	"socket:type2_cable": 43.5,
	"socket:typee": 3.7,
	"socket:type2_combo": 400,
	"socket:chademo": 400,
};

/** A registry's 22.08 is the 22 kW everyone writes; a real 7.4 or 3.7 keeps its decimal. */
const POWER_KW = (n: number) => {
	const whole = Math.round(n);
	return `${Math.abs(n - whole) < 0.15 ? whole : Number(n.toFixed(1))} kW`;
};

/** A station named for fast DC charging ("RNO ETATS UNIS - Borne DC", "Charge ultra-rapide"). */
const DC_NAME = /\bDC\b|\brapides?\b/i;

/** A type 2 point with its cable attached is `socket:type2_cable`, not a socket. */
const cable = (r: In) => has(r, "type2_cable_attached");

/**
 * A type 2 point that leaves the cable blank, which may be either. It is counted as a socket,
 * but only to fill a gap, and rules out no cable.
 */
const unstated = (r: In) => has(r, "socket_type2") && !r.type2_cable_attached;

const SOCKETS: [string, string, (r: In) => boolean][] = [
	["socket:type2", "socket_type2", (r) => !cable(r)],
	["socket:type2_cable", "socket_type2", cable],
	["socket:type2_combo", "socket_ccs", () => true],
	["socket:chademo", "socket_chademo", () => true],
	["socket:typee", "socket_ef", () => true],
];

/** Each socket type's listed points, for matching only. */
const listedSockets = (rows: In[]) =>
	SOCKETS.map(([k, input, only]) => ({
		k,
		v: String(rows.filter((r) => has(r, input) && only(r)).length),
	})).filter((s) => s.v !== "0" && !(s.k === "socket:type2" && rows.some(unstated)));

const DC = ["socket_ccs", "socket_chademo"];

const AC_TYPE2 = ["socket:type2", "socket:type2_cable"];

const CONNECTORS = ["socket_type2", "socket_ccs", "socket_chademo", "socket_ef", "socket_other"];

/** How many connector types a point carries. */
const kinds = (r: In) =>
	new Set(SOCKETS.filter(([, f, only]) => has(r, f) && only(r)).map(([, f]) => f)).size +
	(has(r, "socket_other") ? 1 : 0);

export interface Reading {
	capacity?: Answer;
	/** Each socket type's count, and its output where one is known, in the order they are proposed. */
	sockets: Record<string, Answer>;
	absent: string[];
	notes: string[];
	fit?: { k: string; v: string }[];
}

const cache = new WeakMap<Site, Reading>();

/**
 * A station's capacity and connectors from its charge points, and what the register leaves
 * unsure. Nothing is guessed: where a count or a connector cannot be pinned down, it is left
 * out and the reviewer is told why.
 */
export function readSockets(rows: In[], site: Site): Reading {
	const known = cache.get(site);
	if (known) return known;
	const reading = read(rows, site);
	cache.set(site, reading);
	return reading;
}

function read(rows: In[], site: Site): Reading {
	const { current } = site;
	const first = rows[0];
	// A row is a charge point whether or not the operator gave it an id ("Non concerné").
	const points = new Set(rows.map((r, i) => pointIn(r) ?? `row ${i}`)).size;
	const counts = current.map(
		(s) => new Set(s.rows.map((r) => Number.parseInt(r.point_count, 10)).filter((n) => n > 0)),
	);
	const declaredCount = counts.length === 1 && counts[0].size === 1 ? [...counts[0]][0] : 0;
	const oneRows = current.flatMap((s) => (s.oneRow && s.n ? [s.n] : []));
	// A lone station whose rows disagree on its count, or whose count is not the points it
	// lists, may list only some of them. On a site of several stations the listed points
	// stand: operators fill the count with 1 on every station of a car park.
	const unsure =
		current.length === 1 &&
		!oneRows.length &&
		(counts[0].size > 1 || (counts[0].size === 1 && !counts[0].has(current[0].rows.length)));
	// A DC cabinet's type 2 outlet is declared as a point of its own at the cabinet's power
	// (180 kW), and is not a bay of its own. A station of type 2 points alone at that power
	// is an AC station declared at its feed's power, and its points are bays. A type 2 power
	// over 1000 is watts (22000), which says nothing about a cabinet.
	const withDc = new Set(rows.flatMap((r, i) => (DC.some((f) => has(r, f)) ? [site.keys[i]] : [])));
	const typeTwoKw = (r: In) => {
		const p = Number(r.power_kw);
		return p > 1000 ? p / 1000 : p;
	};
	const acOnDc = rows.filter(
		(r, i) =>
			withDc.has(site.keys[i]) &&
			pointIn(r) &&
			has(r, "socket_type2") &&
			kinds(r) === 1 &&
			typeTwoKw(r) > MAX_KW["socket:type2"],
	).length;
	// A DC unit's type 2 outlet can also be declared below 43.5 kW, at the unit's power (IKEA
	// Lyon's 24 kW unit, `…9691` CCS and `…9692` type 2): a point numbered as another connector
	// of a DC point, at that point's power, gives no type 2 output.
	const dcRows = rows.filter((r) => DC.some((f) => has(r, f)));
	const dcOutlet = (r: In) => {
		const p = pointIn(r);
		const kw = Number(r.power_kw);
		return (
			!!p &&
			dcRows.some((d) => {
				const q = pointIn(d);
				return !!q && q !== p && q.slice(0, -1) === p.slice(0, -1) && Number(d.power_kw) === kw;
			})
		);
	};
	const oneRow = oneRows.length > 0;
	const capacity = unsure
		? 0
		: points - oneRows.length + oneRows.reduce((a, n) => a + n, 0) - acOnDc || declaredCount;
	const notes: string[] = [];
	if (oneRow)
		notes.push(
			current.length === 1
				? `The registry declares ${declaredCount} charge points as a single row, so their sockets are left out`
				: oneRows.length === 1
					? "1 of the site's stations is declared as a single row, so sockets are left out"
					: `${oneRows.length} of the site's stations are each declared as a single row, so sockets are left out`,
		);
	if (unsure)
		notes.push(
			`The registry declares ${[...counts[0]].sort((a, b) => a - b).join(" and ")} charge points and lists ${current[0].rows.length}, so capacity and sockets are left out`,
		);

	// `point_count` is what the operator declared for one of the stations merged here, and the
	// distinct points are what the rows show; quote the one the value really is.
	let answer: Answer | undefined;
	if (capacity && first.point_count === String(capacity))
		answer = { value: String(capacity), conf: 0.85, evidence: { input: "point_count" } };
	else if (capacity)
		answer = {
			value: String(capacity),
			conf: 0.8,
			evidence: {
				input: "point_id",
				shown: acOnDc
					? `${points} distinct, ${acOnDc} of them type 2 alone above 43.5 kW`
					: `${capacity} distinct`,
				kind: "derived",
			},
		};

	const absent: string[] = [];
	// The schema gives one power per charge point and none per connector. That power is a
	// connector's only when the point has that connector alone, or when it is the CCS of a
	// DC unit: the type 2 cable on a 300 kW unit is AC, 22–43 kW, and CHAdeMO beside CCS
	// tops out near 50–100 kW. One point where the power cannot be pinned on this type and
	// the type gets no output, rather than a guess.
	// Absence is read over every declaration: two of one point can disagree on its
	// connectors, and only what none of them lists is known to be missing.
	// A declaration ticking every connector type on every point says nothing about any.
	const everything = rows.every((r) => CONNECTORS.every((f) => has(r, f)));
	if (everything)
		notes.push("The registry ticks every connector type on every point, so sockets are left out");
	// A point naming no connector may carry any, so no type's count is known to be whole,
	// nor any type known to be missing.
	const blank = oneRow || unsure ? 0 : rows.filter((r) => kinds(r) === 0).length;
	if (blank)
		notes.push(
			blank === rows.length
				? "None of its charge points names a connector, so sockets are left out"
				: `${blank} of its ${rows.length} charge points name no connector, so sockets are left out`,
		);
	// A station its own name calls DC that ticks no DC connector has its connectors wrong
	// (Mobilize's "Borne DC" at 62.5 kW ticks type 2 and E/F), so they say nothing either.
	const misnamed = new Set(
		current
			.filter(
				(s) =>
					DC_NAME.test(s.rows[0].station_name) && !s.rows.some((r) => DC.some((f) => has(r, f))),
			)
			.map((s) => s.id),
	);
	const dcNamed =
		oneRow || unsure
			? 0
			: rows.filter((r, i) => kinds(r) > 0 && misnamed.has(site.keys[i] ?? "")).length;
	if (dcNamed)
		notes.push(
			`${dcNamed} of its ${rows.length} charge points are on a station named for DC charging that ticks no DC connector, so sockets are left out`,
		);
	const unknown = blank + dcNamed;
	if (site.recovered)
		notes.push(
			`The registry's newest declaration names no connector on ${site.recovered} of its charge points; their connectors are an older declaration's`,
		);
	const sockets: Record<string, Answer> = {};
	for (const [k, input, only] of oneRow || everything || unsure || unknown ? [] : SOCKETS) {
		const carrying = rows.filter((r) => has(r, input) && only(r));
		if (carrying.length === 0) {
			if (!site.stated.some((r) => has(r, input) && (only(r) || unstated(r)))) absent.push(k);
			continue;
		}
		const gap = k === "socket:type2" && carrying.some(unstated);
		sockets[k] = {
			value: String(carrying.length),
			conf: 0.9,
			addOnly: gap,
			evidence: {
				input,
				shown: `true on ${carrying.length} of ${rows.length} points`,
				kind: "derived",
			},
		};
		const shared = carrying.some((r) => kinds(r) > 1);
		if (shared && k !== "socket:type2_combo") continue;
		const powered = AC_TYPE2.includes(k) ? carrying.filter((r) => !dcOutlet(r)) : carrying;
		const power = Math.max(0, ...powered.map((r) => Number(r.power_kw) || 0));
		if (power === 0 || power > (MAX_KW[k] ?? Number.POSITIVE_INFINITY)) continue;
		sockets[`${k}:output`] = {
			value: POWER_KW(power),
			conf: shared ? 0.7 : 0.8,
			addOnly: gap,
			evidence: { input: "power_kw", shown: String(power), kind: "derived" },
		};
	}
	if (!unsure && !unknown && !site.declared.some((r) => has(r, "socket_other"))) {
		absent.push(...OTHER_SOCKETS);
		// `socket_ef` is an E/F outlet, and F is Schuko: the registry cannot tell which.
		if (!site.declared.some((r) => has(r, "socket_ef"))) absent.push("socket:schuko");
	}
	if (!everything && rows.some((r) => has(r, "socket_other")))
		notes.push(
			"The registry lists connectors of another type on this station, which it does not name",
		);

	return {
		capacity: answer,
		sockets,
		absent,
		notes,
		fit: unsure && !oneRow && !everything && !unknown ? listedSockets(rows) : undefined,
	};
}
