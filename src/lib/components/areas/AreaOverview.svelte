<script lang="ts">
// All boundaries on one map. Clicking a shape gives the summary card; the
// rail (or the card's own button) is how you get to the full detail.

import AreaMap from "$lib/components/AreaMap.svelte";
import MetricTiles from "$lib/components/MetricTiles.svelte";
import { comma, num, statusText } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Tone } from "$lib/types";

const list = $derived(review.visibleAreas);
const paused = $derived(list.filter((a) => review.paused[a.id]).length);
const never = $derived(list.filter((a) => a.lastRun === "never").length);

const totals = $derived.by(() => ({
	pending: list.reduce((n, a) => n + a.pending, 0),
	pois: list.reduce((n, a) => n + num(a.pois), 0),
	acc: list.reduce((n, a) => n + a.accepted30, 0),
	sqkm: list.reduce((n, a) => n + review.sqkmOf(a), 0),
}));

const tiles = $derived([
	{
		label: "areas",
		value: list.length - paused + " of " + list.length,
		sub: paused ? paused + " paused" : "all active",
		tone: (paused ? "warn" : "ok") as Tone,
	},
	{ label: "pending review", value: comma(totals.pending), sub: "in the queue now" },
	{ label: "POIs watched", value: comma(totals.pois), sub: "inside all boundaries" },
	{
		label: "accepted",
		value: comma(totals.acc),
		sub: "last 30 days",
		tone: (totals.acc ? "ok" : null) as Tone,
	},
	{ label: "coverage", value: comma(totals.sqkm) + " km²", sub: "total boundary area" },
]);

const card = $derived.by(() => {
	const c = review.areaCard;
	const a = c ? list.find((x) => x.id === c.id) : null;
	if (!c || !a) return null;
	const status = review.paused[a.id]
		? "paused"
		: a.status === "first run queued"
			? "queued"
			: a.status;
	return {
		pos: c,
		area: a,
		status,
		rows: [
			[
				"boundary",
				a.def === "radius"
					? (review.radiusOf(a) / 1000).toFixed(1) + " km radius"
					: "relation/" + a.rel,
			],
			["pending", String(a.pending)],
			["POIs watched", a.pois],
			["sources on", String(review.sourceCount(a))],
			["last run", a.lastRun],
		],
	};
});
</script>

<div class="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
	<div class="flex shrink-0 flex-wrap items-baseline justify-between gap-4 border-b border-line bg-bar px-[18px] py-3">
		<span class="shrink-0 text-[14px] font-medium whitespace-nowrap text-ink">All areas</span>
		<span class="text-[12px] {never || paused ? 'text-warn' : 'text-faint'}">
			{#if never}
				{never}{never === 1 ? " area has" : " areas have"} never run
			{:else if paused}
				{paused}{paused === 1 ? " area is" : " areas are"} paused — nothing is fetched for {paused === 1 ? "it" : "them"}
			{:else}
				every area fetched on schedule
			{/if}
		</span>
	</div>

	<div class="relative h-[200px] shrink-0 border-b border-line bg-bar lg:h-auto lg:min-h-[190px] lg:flex-1">
		<AreaMap class="h-full w-full" />

		{#if card}
			<div
				class="m-fade absolute z-[600] min-w-[206px] -translate-x-1/2 rounded-md border border-edge-strong bg-panel px-3 py-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.5)]"
				style="left: {card.pos.x}px; top: {card.pos.top}px"
			>
				<div class="flex items-baseline justify-between gap-2.5">
					<span class="text-[13px] text-ink">{card.area.name}</span>
					<span class="shrink-0 text-[10.5px] tracking-[0.04em] {statusText(card.status)}">{card.status}</span>
				</div>
				<div class="mt-2 grid grid-cols-[auto_auto] gap-x-[14px] gap-y-[3px] text-[11.5px] text-faint">
					{#each card.rows as r (r[0])}
						<span>{r[0]}</span>
						<span class="text-right whitespace-nowrap text-ink-2">{r[1]}</span>
					{/each}
				</div>
				<div class="mt-2.5 flex items-center gap-2">
					<button
						class="cursor-pointer rounded-sm border-0 bg-accent px-2.5 py-[5px] text-[12px] font-semibold text-accent-ink"
						onclick={() => {
							review.areaId = card.area.id;
							review.draft = null;
							review.areaCard = null;
						}}>full details ›</button
					>
					<button
						class="cursor-pointer rounded-sm border border-line bg-transparent px-[9px] py-[5px] text-[12px] text-faint hover:text-ink"
						onclick={() => (review.areaCard = null)}>close</button
					>
				</div>
			</div>
		{/if}
	</div>

	<MetricTiles {tiles} />

	<div class="shrink-0 px-4 py-2.5 text-[11px] text-faint">
		Boundaries of all {list.length} areas · click one for a summary, or a rail row for full details
	</div>
</div>
