import OpeningHours from "opening_hours";
import { LOGIN_PORTAL, SAME_VALUE } from "../fr/tags";
import { digits, fold } from "../fr/text";
import { streetDigits } from "../fr/words";
import { houseNumber, ids, values } from "../text";

function url(s: string): { https: boolean; host: string; path: string } | null {
	try {
		const u = new URL(/^https?:\/\//i.test(s.trim()) ? s.trim() : `http://${s.trim()}`);
		const path = u.pathname.replace(/\/+$/, "").toLowerCase();
		return { https: u.protocol === "https:", host: u.hostname.replace(/^www\./, ""), path };
	} catch {
		return null;
	}
}

const withoutTld = (host: string) => host.replace(/\.[^.]+$/, "");

/**
 * Whether the directory's site `a` adds nothing to the mapper's `b`: the same site at a page
 * of it or its root, or the same name under another TLD, which a directory alone does not
 * settle. Nor does an ENT, a school's pupil-and-parent login portal, replace its public site,
 * and a mapper's https is never taken back to http.
 */
function sameSite(a: string, b: string): boolean {
	const [pa, pb] = [url(a), url(b)];
	if (!pa || !pb) return a.trim().toLowerCase() === b.trim().toLowerCase();
	if (LOGIN_PORTAL.test(pa.host)) return true;
	if (pa.host !== pb.host) return withoutTld(pa.host) === withoutTld(pb.host);
	if (pb.https && !pa.https) return true;
	return pa.path.startsWith(pb.path) || pb.path.startsWith(pa.path);
}

/** Accents, case, punctuation and `&` for "et" are how a registry and a mapper differ, not what they say. */
const NAMES = ["name", "operator", "network", "brand", "owner", "addr:street", "addr:city"];

/** Registries write "open all day" as the last minute they bother to count to. */
const allDay = (s: string) =>
	/^(Mo-Su )?00:00-(24:00|23:5\d|00:00)$/.test(s.trim()) ? "24/7" : s.trim();

/** A week of opening hours compared hour by hour, so `Mo 00:00-23:59, Tu …` is `Mo-Fr 00:00-24:00`. */
function sameHours(a: string, b: string): boolean {
	if (allDay(a) === allDay(b)) return true;
	const read = (s: string) => new OpeningHours(s.trim().replace(/23:5\d\b/g, "24:00"), null, 0);
	try {
		// Typed as a boolean, but answers `[equal, differences?]`.
		const [equal] = read(a).isEqualTo(read(b), new Date(Date.UTC(2024, 0, 1))) as unknown as [
			boolean,
		];
		return equal;
	} catch {
		return false;
	}
}

/** The coarser value an `operator:type` refines: a non-profit school is a private one. */
const OPERATOR_TYPE: Record<string, string> = {
	private_non_profit: "private",
	private_for_profit: "private",
	religious: "private",
	community: "private",
	government: "public",
	municipal: "public",
};

/**
 * Whether the proposed value `a` says what the object's `b` already does, so a re-spaced
 * phone number is not an edit, nor a coarser word for what a mapper wrote finely.
 */
export function sameValue(key: string, a: string, b: string): boolean {
	if (a === b) return true;
	const k = key.replace(/^contact:/, "");
	if (k === "addr:street" || k === "street") return streetDigits(fold(a)) === streetDigits(fold(b));
	if (NAMES.includes(k)) return fold(a) === fold(b);
	if (k === "opening_hours") return sameHours(a, b);
	if (k.endsWith(":output")) return Number.parseFloat(a) === Number.parseFloat(b);
	if (k === "phone" || k === "fax" || k === "mobile") return digits(a) === digits(b);
	if (k === "website") return sameSite(a, b);
	if (k === "addr:housenumber" || k === "housenumber") return houseNumber(a) === houseNumber(b);
	if (k === "operator:type") return OPERATOR_TYPE[b] === a;
	if (SAME_VALUE[k]) return SAME_VALUE[k](a, b);
	// One object often carries several establishments' ids (a collège and its SEGPA):
	// the record's own id among them agrees, and replacing the list would delete the others.
	if (k.startsWith("ref:")) {
		const had = new Set(ids(b));
		return ids(a).every((x) => had.has(x));
	}
	if (a.includes(";") || b.includes(";")) {
		const sa = new Set(values(a));
		const sb = new Set(values(b));
		// One value among the object's several is that value: a cité scolaire is
		// `school:FR=collège;primaire;lycée` to each of its establishments.
		if (sa.size === 1 && sb.has([...sa][0])) return true;
		return sa.size === sb.size && [...sa].every((x) => sb.has(x));
	}
	return a.trim() === b.trim();
}

/**
 * Whether two records give one site. Against OSM a page and its site's root agree (`sameSite`),
 * but two establishments giving a root and a page of it are giving two pages.
 */
export function sameUrl(a: string, b: string): boolean {
	const [pa, pb] = [url(a), url(b)];
	if (!pa || !pb) return a.trim().toLowerCase() === b.trim().toLowerCase();
	return pa.host === pb.host && pa.path === pb.path;
}
