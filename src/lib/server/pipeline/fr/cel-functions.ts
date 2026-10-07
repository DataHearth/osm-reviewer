import { coord } from "../row";
import { stationAddress } from "./irve-address";
import { siteOf } from "./irve-declarations";
import { addressOf } from "./school-address";
import { addressQuery } from "./text";

/** What a French mapping's rules may call beyond the base functions: the signature CEL checks against, and its code. */
export const celFunctions: [string, (...args: string[]) => unknown][] = [
	[
		"streetQuery(string, string, string, string): string",
		(street, more, postcode, city) => addressOf({ street, more, postcode, city })?.query ?? "",
	],
	[
		"stationAddress(string, string, string, string): string",
		(raw, postcode, commune, insee) => stationAddress(raw, postcode, commune, insee),
	],
	[
		"addressQuery(string, string, string): string",
		(line, postcode, city) => addressQuery(line, postcode, city),
	],
	[
		"stationSite(string, string, string): string",
		(lat, lon, operator) => {
			const at = coord(lat, lon);
			return at ? siteOf(at, operator) : "";
		},
	],
];
