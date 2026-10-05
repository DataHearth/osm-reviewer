import "leaflet/dist/leaflet.css";

export type Leaflet = typeof import("leaflet");

// The app ships no tiles of its own: every map is live OSM raster, filtered to
// the dark ground at the pane level so the markers keep their real colour.
const DARK_TILES = "invert(0.92) hue-rotate(180deg) saturate(0.4) contrast(0.88)";

let pending: Promise<Leaflet> | null = null;

// Leaflet touches `window` at module scope, so it can only be imported once the
// browser is there — never at the top of a component that also renders on the server.
export function ensureLeaflet(): Promise<Leaflet> {
	pending ??= import("leaflet");
	return pending;
}

/** Read a palette token — Leaflet paints to canvas, which CSS classes cannot reach. */
export const token = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A map on OSM raster tiles, already filtered dark. */
export function darkMap(L: Leaflet, el: HTMLElement, opts: import("leaflet").MapOptions) {
	const map = L.map(el, opts);
	L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		attribution: "&copy; OpenStreetMap",
	}).addTo(map);
	const pane = map.getPane("tilePane");
	if (pane) pane.style.filter = DARK_TILES;
	return map;
}

/**
 * A plausible-looking commune outline: a closed ring around `center` whose
 * radius wobbles deterministically with `seed`. Stands in for the real
 * relation geometry, which the pipeline fetches on the first run.
 */
export function ring(center: [number, number], km: number, seed: number): [number, number][] {
	const n = 30;
	const out: [number, number][] = [];
	const kx = 1 / (111 * Math.cos((center[0] * Math.PI) / 180));
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		const r =
			km *
			(0.8 +
				0.16 * Math.sin(a * 2.3 + seed) +
				0.1 * Math.sin(a * 4.1 + seed * 1.7) +
				0.05 * Math.sin(a * 7.3 + seed));
		out.push([center[0] + (r / 111) * Math.cos(a), center[1] + r * kx * Math.sin(a)]);
	}
	return out;
}
