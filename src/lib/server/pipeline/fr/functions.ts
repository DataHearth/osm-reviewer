import type { TagFunction } from "../mapping/evaluate";
import { MAILBOX, withheldMailbox } from "./mailbox";
import { addressOf } from "./school-address";
import { schoolName } from "./school-name";

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
	"fr.school/name": name,
	"fr.school/mailbox": mailbox,
	"fr.school/address": address,
};
