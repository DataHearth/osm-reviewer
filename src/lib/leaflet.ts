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
