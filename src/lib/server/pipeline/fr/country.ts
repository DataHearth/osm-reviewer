import { type CelFunction, celFunctions } from "./cel-functions";
import { MAILBOX } from "./mailbox";
import { phoneFR } from "./text";

/** South, west, north, east. */
type Box = [number, number, number, number];

/** What a mapping's value checks need to know about a country. */
export interface Country {
	/** Where a position can be, overseas territories included; a generous box, not a border. */
	boxes: Box[];
	/** The number in OSM's spelling, or null when it is not a phone number there. */
	phone(raw: string): string | null;
	mailbox: RegExp;
	/** The code a mapping's rules may call, by the kind it maps. */
	celFunctions: Record<string, CelFunction[]>;
}

export const COUNTRIES: Record<string, Country> = {
	FR: {
		boxes: [
			[41, -5.5, 51.5, 10],
			[14.2, -63.2, 18.2, -60.7],
			[1.8, -55, 6, -51.5],
			[-21.5, 55, -20.8, 56],
			[-13.1, 44.9, -12.5, 45.4],
			[46.7, -56.5, 47.2, -56],
			[-23, 163.5, -19.5, 168.2],
			[-28, -155, -7, -134],
			[-14.5, -178.5, -13, -176],
		],
		phone: phoneFR,
		mailbox: MAILBOX,
		celFunctions,
	},
};

export const inCountry = (country: Country, lat: number, lon: number) =>
	country.boxes.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
