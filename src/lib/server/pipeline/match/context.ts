import { mainKeys } from "./kinds";
import { ADDRESS_HELD } from "./ops";

/**
 * What tells a reviewer this is the right object comes first: what kind of object it is, and
 * the identifiers and level it already carries. The address, which rarely settles it, comes last.
 * The order is pinned, not declared by the kinds: it is display, and a function because the main
 * keys come from the registry.
 */
const contextKeys = () => [
	...mainKeys(),
	"name",
	"ref:UAI",
	"ref:EU:EVSE",
	"ref:FR:SIRET",
	"school:FR",
	"operator",
	"brand",
	"opening_hours",
	"phone",
	"contact:phone",
	"email",
	"contact:email",
	"website",
	"contact:website",
];

const contextRank = (k: string, keys: string[]) => {
	const at = keys.indexOf(k);
	if (at >= 0) return at;
	return k.startsWith("addr:") || ADDRESS_HELD.test(k) ? keys.length : -1;
};

/** The few of an object's tags a reviewer looks at for context. */
export function contextTags(unchanged: { k: string; v: string }[]) {
	const keys = contextKeys();
	return unchanged
		.filter((x) => contextRank(x.k, keys) >= 0)
		.sort((a, b) => contextRank(a.k, keys) - contextRank(b.k, keys))
		.slice(0, 6);
}
