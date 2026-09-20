<script lang="ts">
// The candidate's location, on live OSM tiles. Nearby POIs are drawn as grey
// dots so a duplicate-looking cluster is visible before accepting a new node.
import { onMount } from "svelte";
import { darkMap, ensureLeaflet, token } from "$lib/leaflet";
import { review } from "$lib/stores/review.svelte";

let { class: cls = "" }: { class?: string } = $props();

let el = $state<HTMLDivElement | null>(null);
let map: any = null;
let layer: any = null;
let L: any = null;
let drawnFor: string | null = null;

const OFFSETS = [
	[0.00035, 0.0004],
	[-0.0003, 0.00055],
	[0.0002, -0.0006],
];

onMount(() => {
	let dead = false;
	ensureLeaflet().then((lib) => {
		if (dead || !el) return;
		L = lib;
		map = darkMap(L, el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
		layer = L.layerGroup().addTo(map);
		draw();
	});
	return () => {
		dead = true;
		map?.remove();
		map = null;
	};
});

function draw() {
	const c = review.candidate;
	if (!map || !layer || !c) return;
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
		for (const [dlat, dlon] of OFFSETS) {
			L.circleMarker([c.lat + dlat, c.lon + dlon], {
				radius: 4,
				color: token("--bg"),
				weight: 1,
				fillColor: token("--faint"),
				fillOpacity: 1,
			}).addTo(layer);
		}
	}
	map.invalidateSize();
}

$effect(() => {
	review.candidate?.id;
	draw();
});
</script>

<div bind:this={el} class={cls}></div>
