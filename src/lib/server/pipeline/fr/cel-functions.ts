import { coord } from "../row";
import { stationAddress } from "./irve-address";
import { siteOf } from "./irve-declarations";
import { addressOf } from "./school-address";
import { addressQuery } from "./text";

export type CelFunction = [signature: string, handler: (...args: string[]) => unknown];

const school: CelFunction[] = [
	[
		"streetQuery(string, string, string, string): string",
		(street, more, postcode, city) => addressOf({ street, more, postcode, city })?.query ?? "",
	],
];

const chargingStation: CelFunction[] = [
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

/** What a French mapping's rules may call beyond the base functions, by the kind it maps; a mapping sees them as `fr_<kind>_<name>`. */
export const celFunctions: Record<string, CelFunction[]> = {
	school,
	charging_station: chargingStation,
};
