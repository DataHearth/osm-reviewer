const decimals = (v: string) => /\.(\d+)$/.exec(v)?.[1].length ?? 0;

const COARSE_DECIMALS = 2;

/** A point the registry gives to few decimals can be a few hundred metres off, and the reviewer is told so. */
export function positionPrecision({ lat, lon }: Record<string, string>): string[] {
	const places = Math.min(decimals(lat), decimals(lon));
	return places <= COARSE_DECIMALS
		? [
				`The registry places it to ${places} decimal${places === 1 ? "" : "s"} only (${lat}, ${lon}), which can be a few hundred metres off`,
			]
		: [];
}
