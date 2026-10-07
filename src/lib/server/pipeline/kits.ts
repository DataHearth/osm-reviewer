import { kit as chargingStation } from "./any/charging-station";
import { kit as school } from "./fr/school";
import type { KitFactory } from "./match/kit";

/** The one place that names the modules a mapping's `matching.kit` can point at. */
export const KITS: Record<string, KitFactory> = {
	"fr.school": school,
	"any.charging_station": chargingStation,
};
