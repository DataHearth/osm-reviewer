<script lang="ts">
// Boundaries on live OSM tiles. Three things this draws, in the order the
// screen asks for them: the draft being defined, one saved area, or all of
// them at once (where a click gives the summary card).

import type {
	Circle,
	LatLng,
	LayerGroup,
	Map as LeafletMap,
	LeafletMouseEvent,
	Polygon,
	PolylineOptions,
} from "leaflet";
import { onMount } from "svelte";
import { darkMap, ensureLeaflet, type Leaflet, token } from "$lib/leaflet";
import type { AreaDraft } from "$lib/schemas/area";
import { review } from "$lib/stores/review.svelte";

// The draft comes from the form that owns it, not from a global: the form's
// own store is the only copy that gets posted.
let {
	class: cls = "",
	draft = null,
	onCenter,
}: {
	class?: string;
	draft?: AreaDraft | null;
	onCenter?: (c: [number, number]) => void;
} = $props();

let el = $state<HTMLDivElement | null>(null);
let m: { L: Leaflet; map: LeafletMap; layer: LayerGroup } | null = null;
let drawnKey: string | null = null;

onMount(() => {
	let dead = false;
	ensureLeaflet().then((lib) => {
		if (dead || !el) return;
		const map = darkMap(lib, el, {
			zoomControl: true,
			attributionControl: true,
			scrollWheelZoom: true,
		});
		map.setView([43.6045, 1.444], 11);
		m = { L: lib, map, layer: lib.layerGroup().addTo(map) };
		map.on("click", (e: LeafletMouseEvent) => {
			if (draft && draft.mode === "radius") onCenter?.([e.latlng.lat, e.latlng.lng]);
			else if (review.areaCard) review.areaCard = null;
		});
		map.on("movestart zoomstart", () => {
			if (review.areaCard) review.areaCard = null;
		});
		drawnKey = null;
		draw();
	});
	return () => {
		dead = true;
		m?.map.remove();
		m = null;
	};
});

type Bbox = [number, number, number, number];

/**
 * A relation is drawn as the bounding box it is stored as — the box the pipeline reads
 * and matches over — since its real outline is never fetched. None stored, no shape.
 */
function bboxShape(L: Leaflet, bbox: Bbox | null | undefined, style: PolylineOptions) {
	if (!bbox) return null;
	const [s, w, n, e] = bbox;
	return L.rectangle(
		[
			[s, w],
			[n, e],
		],
		style,
	);
}

function shapeStyle(ink: string, dashed: boolean, fill = 0.1) {
	return {
		color: ink,
		weight: 2,
		fillColor: ink,
		fillOpacity: fill,
		dashArray: dashed ? "5 4" : undefined,
	};
}

/** Where the summary card sits: above the click, flipped below near the top edge. */
function showCard(id: string, latlng: LatLng, e?: LeafletMouseEvent) {
	if (!m) return;
	const { L, map } = m;
	const p = map.latLngToContainerPoint(latlng);
	const size = map.getSize();
	const H = 182;
	let top = p.y - H - 14;
	if (top < 8) top = p.y + 14;
	top = Math.min(Math.max(8, top), Math.max(8, size.y - H - 8));
	review.areaCard = {
		id,
		x: Math.max(112, Math.min(size.x - 112, Math.round(p.x))),
		top: Math.round(top),
	};
	if (e) L.DomEvent.stopPropagation(e);
}

function draw() {
	if (!m) return;
	const { L, map, layer } = m;
	const d = draft;

	// A relation draft with nothing picked yet: the whole country, no shape.
	if (d && d.mode === "relation" && !d.picked) {
		if (drawnKey !== "empty") {
			drawnKey = "empty";
			layer.clearLayers();
			map.setView([46.6, 2.4], 5);
		}
		map.invalidateSize();
		return;
	}

	if (!d && !review.areaId) {
		const all = review.areas;
		const key =
			"all|" +
			all
				.map((a) => `${a.id}:${review.radiusOf(a)}:${a.bbox}:${review.paused[a.id] ? "p" : "a"}`)
				.join(",");
		if (drawnKey !== key) {
			drawnKey = key;
			layer.clearLayers();
			const shapes: (Circle | Polygon)[] = [];
			for (const a of all) {
				const ink = review.paused[a.id] ? token("--faint") : token("--accent");
				const sh =
					a.def === "radius"
						? L.circle(a.center, { radius: review.radiusOf(a), ...shapeStyle(ink, true) })
						: bboxShape(L, a.bbox, shapeStyle(ink, false));
				const show = (e?: LeafletMouseEvent) =>
					showCard(a.id, e?.latlng ?? L.latLng(a.center[0], a.center[1]), e);
				if (sh) {
					sh.addTo(layer);
					sh.on("click", show).on("dblclick", () => {
						review.areaId = a.id;
						review.draft = null;
						review.areaCard = null;
					});
					shapes.push(sh);
				}
				L.circleMarker(a.center, {
					radius: 3,
					color: token("--bg"),
					weight: 1,
					fillColor: ink,
					fillOpacity: 1,
				})
					.addTo(layer)
					.on("click", show);
			}
			if (shapes.length) {
				let b = shapes[0].getBounds();
				for (const sh of shapes.slice(1)) b = b.extend(sh.getBounds());
				map.fitBounds(b, { padding: [30, 30] });
			}
		}
		map.invalidateSize();
		return;
	}

	const a = d ? null : review.area(review.areaId);
	const mode = d ? d.mode : a?.def;
	const center = d ? (d.mode === "radius" ? d.center : d.picked?.center) : a?.center;
	if (!center) return;
	const radius = d ? d.radius : a ? review.radiusOf(a) : 2500;
	const bbox = d ? d.picked?.bbox : a?.bbox;
	const key = [d ? "draft" : a?.id, mode, center[0], center[1], radius, bbox].join("|");
	if (drawnKey !== key) {
		drawnKey = key;
		layer.clearLayers();
		const ink = token("--accent");
		const shape =
			mode === "radius"
				? L.circle(center, { radius: radius || 2500, ...shapeStyle(ink, true, 0.12) })
				: bboxShape(L, bbox, shapeStyle(ink, false, 0.12));
		shape?.addTo(layer);
		L.circleMarker(center, {
			radius: 3,
			color: token("--bg"),
			weight: 1,
			fillColor: ink,
			fillOpacity: 1,
		}).addTo(layer);
		if (shape) map.fitBounds(shape.getBounds(), { padding: [26, 26] });
		else map.setView(center, 12);
	}
	map.invalidateSize();
}

// Re-draw whenever anything the shapes are derived from moves.
$effect(() => {
	review.areaId;
	draft?.mode;
	draft?.radius;
	draft?.center;
	draft?.picked;
	review.radii;
	review.paused;
	review.areas.length;
	draw();
});
</script>

<div bind:this={el} class={cls}></div>
