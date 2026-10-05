<script lang="ts">
// The candidate's location, on live OSM tiles. Its nearby objects are only known
// by label, so the tiles are what show a cluster around it, not markers.

import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { onMount } from "svelte";
import { darkMap, ensureLeaflet, type Leaflet, token } from "$lib/leaflet";
import { review } from "$lib/stores/review.svelte";

let { class: cls = "" }: { class?: string } = $props();

let el = $state<HTMLDivElement | null>(null);
let m: { L: Leaflet; map: LeafletMap; layer: LayerGroup } | null = null;
let drawnFor: string | null = null;

onMount(() => {
	let dead = false;
	ensureLeaflet().then((lib) => {
		if (dead || !el) return;
		const map = darkMap(lib, el, {
			zoomControl: false,
			attributionControl: true,
			scrollWheelZoom: false,
		});
		m = { L: lib, map, layer: lib.layerGroup().addTo(map) };
		draw();
	});
	// Two instances exist (review header at md+, context pane on phone) and one
	// is display:none at any width; the header one also grows and shrinks with
	// its expand button. Either way the map has to re-measure when its box does.
	const ro = new ResizeObserver(() => m?.map.invalidateSize());
	if (el) ro.observe(el);
	return () => {
		ro.disconnect();
		dead = true;
		m?.map.remove();
		m = null;
	};
});

function draw() {
	const c = review.candidate;
	if (!m || !c) return;
	const { L, map, layer } = m;
	if (drawnFor !== c.id) {
		drawnFor = c.id;
		map.setView([c.lat, c.lon], 17);
		layer.clearLayers();
		L.circleMarker([c.lat, c.lon], {
			radius: 7,
			color: token("--bg"),
			weight: 2,
			fillColor: token("--accent"),
			fillOpacity: 1,
		}).addTo(layer);
	}
	map.invalidateSize();
}

$effect(() => {
	review.candidate?.id;
	draw();
});
</script>

<div bind:this={el} class={cls}></div>
