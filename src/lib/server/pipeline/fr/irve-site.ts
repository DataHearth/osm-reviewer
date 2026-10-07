import { distance } from "../geo";
import { str, truthy } from "../row";
import type { Row } from "../types";
import {
	currentStations,
	declarationsOf,
	evseId,
	NOT_A_POINT,
	onePerPoint,
	stationKey,
	stationPosition,
} from "./irve-declarations";
import { LINK_M } from "./irve-sites";

/** A row under the charging-station mapping's input names. */
export type In = Record<string, string>;

export interface Station {
	id: string;
	rows: In[];
	/** The point count its newest declaration gives, when it gives one. */
	n: number | null;
	/** Declared as a single row under its own id, standing for `n` points whose connectors are unknown. */
	oneRow: boolean;
}

/**
 * What the declarations step gathered about one station beyond its charge points: every
 * declaration of it, and each point's own earlier ones. `history` and `keys` follow the
 * record's rows index by index.
 */
export interface Site {
	declared: In[];
	/** The declarations within `LINK_M` of the station's point. */
	near: In[];
	/** `declared`, each point's cable taken from its newest declaration that states it. */
	stated: In[];
	current: Station[];
	history: In[][];
	keys: (string | null)[];
	/** Points whose connectors are an older declaration's, the newest naming none. */
	recovered: number;
}

export const has = (r: In, input: string) => truthy(r[input] ?? "");

export const pointIn = (r: In) => {
	const id = r.point_id;
	return id && !NOT_A_POINT.test(id) ? evseId(id) : null;
};

/** The site of rows given alone, as an example gives them: each row its own only declaration. */
export function defaultSite(rows: In[]): Site {
	const byId = new Map<string, In[]>();
	for (const r of rows) byId.set(r.station_id ?? "", [...(byId.get(r.station_id ?? "") ?? []), r]);
	return {
		declared: rows,
		near: rows,
		stated: rows,
		current: [...byId].map(([id, own]) => ({ id, rows: own, n: null, oneRow: false })),
		history: rows.map((r) => [r]),
		keys: rows.map((r) => r.station_id || null),
		recovered: 0,
	};
}

const CONNECTORS = [
	"prise_type_2",
	"prise_type_combo_ccs",
	"prise_type_chademo",
	"prise_type_ef",
	"prise_type_autre",
];

const NAMED = ["prise_type_2", "prise_type_combo_ccs", "prise_type_chademo", "prise_type_ef"];

const named = (r: Row) => NAMED.some((f) => truthy(str(r, f)));

/**
 * A point's newest row, with the connectors of an older declaration of it when the newest
 * names none: e-Totem's consolidated rows tick only "autre" on DC points its own file lists as
 * CCS, and some rows tick nothing at all.
 */
function withNamedConnectors(r: Row, history: Row[]): Row {
	if (named(r)) return r;
	const older = history.find(named);
	return older
		? {
				...r,
				...Object.fromEntries([...CONNECTORS, "cable_t2_attache"].map((f) => [f, older[f]])),
			}
		: r;
}

/**
 * The declarations step: a station is declared again and again, so it is read from its newest
 * declaration of each charge point, with what older ones said where the newest leaves a field out
 * (an aggregator's copy of an operator's file drops its notes and tariff). The rows come back raw,
 * and again under the mapping's input names, with the register's `gratuit` and `tarification`
 * taken from the newest declaration that states them.
 */
export function readDeclarations(declared: Row[], toInputs: (r: Row) => In) {
	const current = currentStations(declared);
	const own = declarationsOf(onePerPoint(current.flatMap((s) => s.rows)), declared);
	const history = new Map([...own].map(([r, h]) => [withNamedConnectors(r, h), h]));
	const rows = [...history.keys()];
	const first = rows[0];
	const pos = first && stationPosition(first);
	if (!pos) return null;

	const said = (r: Row, field: string) =>
		str(history.get(r)?.find((h) => str(h, field)) ?? r, field);
	const allDeclared = declarationsOf(declared, declared);
	const stated = declared.map((r) => {
		if (str(r, "cable_t2_attache")) return r;
		const older = allDeclared.get(r)?.find((h) => str(h, "cable_t2_attache"));
		return older ? { ...r, cable_t2_attache: str(older, "cable_t2_attache") } : r;
	});
	const site: Site = {
		declared: declared.map(toInputs),
		near: declared
			.filter((r) => {
				const at = stationPosition(r);
				return !!at && distance(at[0], at[1], pos[0], pos[1]) <= LINK_M;
			})
			.map(toInputs),
		stated: stated.map(toInputs),
		current: current.map((s) => ({
			id: s.id,
			rows: s.rows.map(toInputs),
			n: s.n,
			oneRow: s.oneRow,
		})),
		history: rows.map((r) => (history.get(r) ?? [r]).map(toInputs)),
		keys: rows.map(stationKey),
		recovered: [...own.keys()].filter((r) => !history.has(r)).length,
	};
	const inputs: In[] = rows.map((r) => ({
		...toInputs(r),
		free: said(r, "gratuit"),
		tariff: said(r, "tarification"),
	}));
	return { rows, inputs, site, pos };
}
