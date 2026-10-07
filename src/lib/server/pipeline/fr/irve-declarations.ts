import { distance } from "../geo";
import { coord, str, truthy } from "../row";
import { normaliseName } from "../text";
import type { Row } from "../types";

export const NOT_A_POINT = /^non concern/i;

/**
 * Organisations publishing copies of other operators' files on data.gouv.fr. Their copy of a
 * station often carries the day of the operator's own declaration and a later publish time,
 * while it drops points and names the operator's company as owner (Qualicharge's copy of
 * Izivia's Grand Lyon stations: two points of four, owner "IZIVIA FMET 1" for Grand Lyon).
 */
const AGGREGATORS = new Set(["qualicharge"]);

/** A file of the operator or owner itself, which a same-day copy does not outrank. */
const ownFile = (r: Row) =>
	AGGREGATORS.has(str(r, "datagouv_organization_or_owner").toLowerCase()) ? 0 : 1;

const newest = (r: Row) =>
	`${str(r, "date_maj")}|${ownFile(r)}|${str(r, "last_modified", "datagouv_last_modified")}`;

/**
 * An EVSE id the way two declarations of one point or station are compared: without `*`, the
 * `E`/`P` type letter, or the `P` some files put before a connector's number
 * (`FRALLEGO002084P1` in 2023 is `FRALLEGO0020841` in 2024).
 */
export const evseId = (id: string) =>
	id
		.toUpperCase()
		.replace(/[\s*]/g, "")
		.replace(/^([A-Z]{2}[A-Z0-9]{3})[EP]/, "$1")
		.replace(/P(\d+)$/, "$1");

export const pointOf = (r: Row) => {
	const id = str(r, "id_pdc_itinerance");
	return id && !NOT_A_POINT.test(id) ? evseId(id) : null;
};

/** Each point's newest row, newest first, so a station's single values are read from it. */
export function onePerPoint(rows: Row[]): Row[] {
	const seen = new Set<string>();
	return [...rows]
		.sort((a, b) => newest(b).localeCompare(newest(a)))
		.filter((r) => {
			const id = pointOf(r);
			if (!id) return true;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
}

/**
 * Every declaration of each of `rows`' points, newest first: the same id, or the same number
 * under another operator's prefix.
 */
export function declarationsOf(rows: Row[], declared: Row[]): Map<Row, Row[]> {
	const byNewest = [...declared].sort((a, b) => newest(b).localeCompare(newest(a)));
	const same = (p: string) => {
		const tail = TAIL.exec(p)?.[0];
		return (h: Row) => {
			const q = pointOf(h);
			return !!q && (q === p || (!!tail && TAIL.exec(q)?.[0] === tail));
		};
	};
	return new Map(
		rows.map((r) => {
			const p = pointOf(r);
			return [r, p ? byNewest.filter(same(p)) : [r]];
		}),
	);
}

interface Station {
	id: string;
	file: string;
	rows: Row[];
	points: Set<string>;
	latest: string;
	name: string;
	at: [number, number] | null;
	/** The point count its newest declaration gives, when it gives one. */
	n: number | null;
	/** Declared as a single row under its own id, standing for `n` points whose connectors are unknown. */
	oneRow: boolean;
}

/** A point's number without its operator's prefix, which a site moved to another operator's file keeps. */
export const TAIL = /\d{7,}$/;

/** Within this, two declarations are on the same spot. */
const SAME_SPOT_M = 2;

/**
 * The consolidated file keeps every declaration a station has had: an operator's own file
 * beside its aggregator's, and older ones listing points since removed. Each station is read
 * from its newest declaration whole, by `date_maj`, then the operator's or owner's own file over
 * an aggregator's copy, then `last_modified` (`datagouv_last_modified` in the PAN's file; an
 * operator's file and its aggregator's often share the day), rather than from a union that counts what no longer exists.
 *
 * A station is gone when newer ones list all its points (a pool taking in the stations an
 * operator declared one per point), or a newer one in another file declares it again: some of
 * its points under the same name or the same count (Tisséo Balma-Gramont in 2023, 2024 and
 * 2026; Sowatt's EVBOX at MG Vénissieux), the same name and count on the same spot with none of
 * its points (Caliceo Sainte-Foy), or, for a station declared as one row, as many points as
 * it counted. A point the newer declaration left out was renumbered, so an older station still
 * listing it does not count it again. Stations of one file are one snapshot and never replace
 * each other; two sharing only some points otherwise both stay, and their points count once.
 */
export function currentStations(rows: Row[]): Station[] {
	const file = (r: Row) => str(r, "datagouv_resource_id");
	const byId = new Map<string, Row[]>();
	for (const r of rows) {
		const id = stationKey(r) ?? "";
		byId.set(id, [...(byId.get(id) ?? []), r]);
	}
	const all = [...byId].map(([id, own]): Station => {
		const latest = own.reduce((a, r) => (newest(r) > newest(a) ? r : a), own[0]);
		const decl = onePerPoint(own.filter((r) => file(r) === file(latest)));
		const points = new Set(decl.map(pointOf).filter((p) => p !== null));
		const counts = new Set(decl.map((r) => Number.parseInt(str(r, "nbre_pdc"), 10)));
		const n = counts.size === 1 ? [...counts][0] : Number.NaN;
		return {
			id,
			file: file(latest),
			rows: decl,
			points,
			latest: newest(latest),
			name: normaliseName(str(latest, "nom_station")),
			at: stationPosition(latest),
			n: n > 0 ? n : null,
			oneRow: decl.length === 1 && points.size === 1 && [...points][0] === evseId(id) && n > 1,
		};
	});
	// Some operators declare every point of a site as a station of its own and repeat the
	// site's total on each: as many one-row stations as each says there are, each one point.
	for (const f of new Set(all.map((s) => s.file))) {
		const ones = all.filter((s) => s.file === f && s.oneRow);
		if (ones.length > 1 && ones.every((s) => s.n === ones.length))
			for (const s of ones) {
				s.oneRow = false;
				s.n = 1;
			}
	}
	const listed = (t: Station, p: string) => {
		const tail = TAIL.exec(p)?.[0];
		return t.points.has(p) || (!!tail && [...t.points].some((q) => TAIL.exec(q)?.[0] === tail));
	};
	const shared = (t: Station, s: Station) => [...s.points].filter((p) => listed(t, p)).length;
	const sameSpot = (t: Station, s: Station) =>
		!!t.at && !!s.at && distance(t.at[0], t.at[1], s.at[0], s.at[1]) <= SAME_SPOT_M;
	const sameName = (t: Station, s: Station) => !!t.name && t.name === s.name;
	const sameCount = (t: Station, s: Station) => !!t.n && t.n === s.n;
	const redeclares = (t: Station, s: Station) =>
		t.file !== s.file &&
		(shared(t, s) > 0
			? sameName(t, s) || sameCount(t, s) || ![...s.points].some((p) => t.points.has(p))
			: sameName(t, s) && sameCount(t, s) && sameSpot(t, s));
	const gone = new Map<string, string>();
	const current = all.filter((s) => {
		const newer = all.filter((t) => t.latest > s.latest);
		const by = newer.find((t) => redeclares(t, s));
		if (by) {
			for (const p of s.points) if (!listed(by, p)) gone.set(p, by.latest);
			return false;
		}
		if (s.points.size && [...s.points].every((p) => newer.some((t) => listed(t, p)))) return false;
		if (!s.oneRow) return true;
		const later = newer.filter((t) => t.file !== s.file && !t.oneRow);
		return new Set(later.flatMap((t) => [...t.points])).size !== s.n;
	});
	for (const s of current) {
		s.rows = s.rows.filter((r) => {
			const p = pointOf(r);
			return !p || (gone.get(p) ?? "") <= s.latest;
		});
		s.points = new Set(s.rows.map(pointOf).filter((p) => p !== null));
	}
	return current.filter((s) => s.rows.length > 0);
}

/** The coordinates `position` reads, as the registry wrote them. */
function rawCoords(r: Row): [string, string] | null {
	if (coord(r.consolidated_latitude, r.consolidated_longitude))
		return [str(r, "consolidated_latitude"), str(r, "consolidated_longitude")];
	const xy = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(str(r, "coordonneesXY"));
	return xy && coord(xy[2], xy[1]) ? [xy[2], xy[1]] : null;
}

/** Legal forms and trade words an operator's files add to its name or not ("ZEENCO e-mobility"). */
const COMPANY_NOISE =
	/\b(sas|sasu|sarl|sa|eurl|france|e mobility|emobility|marketing|charging|services|partner network)\b/g;

export function company(name: string): string {
	const n = normaliseName(name);
	return n.replace(COMPANY_NOISE, " ").replace(/\s+/g, " ").trim() || n;
}

export const operatorOf = (r: Row) => company(str(r, "nom_operateur") || str(r, "nom_amenageur"));

export function stationPosition(r: Row): [number, number] | null {
	const flag = str(r, "consolidated_is_lon_lat_correct");
	if (flag && !truthy(flag)) return null;
	const c = rawCoords(r);
	return c ? coord(c[0], c[1]) : null;
}

/** What two records on one spot under one operator share, as the mapping's key for a row naming no station reads it too. */
export const siteOf = (pos: [number, number], operator: string) =>
	`${pos[0].toFixed(6)},${pos[1].toFixed(6)}|${company(operator)}`;

export function stationSite(r: Row): string | null {
	const pos = stationPosition(r);
	return pos ? siteOf(pos, str(r, "nom_operateur") || str(r, "nom_amenageur")) : null;
}

export function stationKey(r: Row): string | null {
	const id = str(r, "id_station_itinerance");
	if (!NOT_A_POINT.test(id)) return id || null;
	// "Non concerné" names no station, and every row of an area saying so would be one record.
	const site = stationSite(r);
	return site ? `${id} ${site}` : null;
}
