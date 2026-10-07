import type { Step } from "../extractor";
import type { TagFunction } from "../mapping/evaluate";
import type { NotesFunction, SitesFunction, SkipFunction } from "../mapping/record";
import { chargingFunctions } from "./charging-functions";
import { stationSite } from "./irve-declarations";
import { positionPrecision } from "./irve-position";
import { readDeclarations } from "./irve-site";
import { link } from "./irve-sites";
import { MAILBOX, withheldMailbox } from "./mailbox";
import { addressOf } from "./school-address";
import { housedSection } from "./school-housed";
import { schoolName } from "./school-name";
import { alsoAtOtherSites } from "./school-sites";

const cleaned = (raw: string) => (raw ? schoolName(raw) : "");

const name: TagFunction = ({ name }) => ({ name: cleaned(name) });

const mailbox: TagFunction = ({ email, name, city, street }): Record<string, string> =>
	MAILBOX.test(email) && !withheldMailbox(email, cleaned(name), `${city} ${street}`)
		? { email }
		: {};

const address: TagFunction = ({
	street,
	address_line_2,
	address_line_3,
	postcode,
	city,
}): Record<string, string> => {
	const at = addressOf({
		street,
		more: `${address_line_2} ${address_line_3}`,
		postcode,
		city,
	});
	return at
		? {
				"addr:housenumber": at.number,
				"addr:street": at.street,
				"addr:postcode": at.postcode,
				"addr:city": at.city,
			}
		: {};
};

/** The code a mapping's `function` names, by the name it gives. */
export const functions: Record<string, TagFunction> = {
	...chargingFunctions,
	"fr.school/name": name,
	"fr.school/mailbox": mailbox,
	"fr.school/address": address,
};

/** The code a mapping's `record.skipBy` names. */
export const skipFunctions: Record<string, SkipFunction> = {
	"fr.school/housed": housedSection,
};

/** The code a mapping's `record.sitesBy` names. */
export const sitesFunctions: Record<string, SitesFunction> = {
	"fr.school/sites": alsoAtOtherSites,
};

/** The code a mapping's `record.notesBy` names. */
export const notesFunctions: Record<string, NotesFunction> = {
	"fr.charging_station/precision": positionPrecision,
};

/** The code a shipped renaming's `steps` names. */
export const steps: Record<string, Step> = {
	"fr.irve/declarations": { rebuild: readDeclarations },
	"fr.irve/sites": { site: stationSite, link },
};
