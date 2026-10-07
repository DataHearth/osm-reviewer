import { normaliseName } from "../text";

/** A mailbox ("_Bp 75", "CS 30012") or a CEDEX, which no street carries and the address base misreads. */
const POSTAL_BOX = /(?:[\s,_–-]+|^)(?:B\.?\s?P\.?|CS)\s*\d+\b|\s+CEDEX(?:\s*\d+)?\b/gi;

/**
 * `adresse_station` carries the postcode and commune or not, a country, sometimes another
 * postcode than the consolidated one ("…, 31000 Toulouse" at 31100): the street part is kept
 * and the consolidated postcode and commune are written once after it. Where the consolidation
 * has no postcode, the address's own postcode and commune stand, and so they do where the
 * address or its INSEE code is in another département than the consolidation put it ("363 Rte
 * de Toulouse, 33140 Villenave-d'Ornon", INSEE 33550, consolidated as 31400 Toulouse).
 */
export function stationAddress(raw: string, postcode: string, commune: string, insee = ""): string {
	const place = normaliseName(commune);
	let street = raw
		.replace(POSTAL_BOX, "")
		.replace(/,\s*france\s*$/i, "")
		.trim()
		.replace(/[\s,–-]+$/, "");
	const cityAfter = (at: number) =>
		street
			.slice(at + 5)
			.split(",")
			.map((s) => s.trim())
			.find(Boolean) ?? "";
	// A number in front is the house's ("23535 Av. du Chater"), unless the commune follows it.
	const code = [...street.matchAll(/(?<!\d)\d{5}(?!\d)/g)].find(
		(m) => m.index > 0 || normaliseName(cityAfter(0)) === place,
	);
	const ownCity = code ? cityAfter(code.index) : "";
	if (code) street = street.slice(0, code.index).replace(/[\s,–-]+$/, "");
	// Only after a comma or a dash: "Rue de Lyon" in Lyon is a street.
	for (let i = street.length - 1; place && i > 0; i--)
		if (/[,–-]\s*$/.test(street.slice(0, i)) && normaliseName(street.slice(i)) === place) {
			street = street.slice(0, i).replace(/[\s,–-]+$/, "");
			break;
		}
	const consolidated = departement(postcode);
	const elsewhere =
		!!consolidated &&
		[code?.[0] ?? "", insee].some((c) => departement(c) && departement(c) !== consolidated);
	if (elsewhere) return [street, [code?.[0], ownCity].filter(Boolean).join(" ")].join(", ");
	const city = postcode || !ownCity || normaliseName(ownCity) === place ? commune : ownCity;
	return [street, [postcode || code?.[0], city].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");
}

/** A postcode's or an INSEE code's département: Corsica's 2A and 2B are 20, overseas ones three digits. */
function departement(code: string): string | null {
	if (!/^(\d{5}|2[AB]\d{3})$/i.test(code)) return null;
	return code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2).replace(/2[AB]/i, "20");
}
