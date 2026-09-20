<script lang="ts">
// One saved area: the boundary it watches, what the last 30 days produced,
// and which global sources are switched on inside it.
import { goto } from "$app/navigation";
import AreaMap from "$lib/components/AreaMap.svelte";
import MetricTiles from "$lib/components/MetricTiles.svelte";
import { boxBtn, ghost, healthTone, statusPill } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Tone } from "$lib/types";

const a = $derived(review.area(review.areaId));
const paused = $derived(!!review.paused[a.id]);
const status = $derived(paused ? "paused" : a.status);
const radius = $derived(review.radiusOf(a));
const sqkm = $derived(review.sqkmOf(a));

const tiles = $derived([
	{
		label: "pending review",
		value: String(a.pending),
		sub: a.pending ? "in the queue now" : "nothing queued",
	},
	{
		label: "accepted",
		value: String(a.accepted30),
		sub: "last 30 days",
		tone: (a.accepted30 ? "ok" : null) as Tone,
	},
	{ label: "POIs watched", value: a.pois, sub: "inside the boundary" },
	{
		label: "last run",
		value: a.lastRun,
		sub: review.sourceCount(a) + (review.sourceCount(a) === 1 ? " source on" : " sources on"),
		tone: (a.lastRun === "never" ? "warn" : null) as Tone,
	},
]);

const defRows = $derived(
	(a.def === "radius"
		? [
				["type", "radius around a point"],
				["centre", a.center[0].toFixed(4) + ", " + a.center[1].toFixed(4), "code"],
				["radius", (radius / 1000).toFixed(2) + " km"],
				["area", sqkm.toFixed(0) + " km²"],
			]
		: [
				["type", "OSM admin relation"],
				["relation", "relation/" + a.rel, "code"],
				["admin level", a.level + " — commune"],
				["area", sqkm + " km²"],
				["boundary synced", a.lastRun === "never" ? "pending first run" : "01-09-2026"],
			]) as [string, string, string?][],
);
</script>

<div class="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
	<div class="flex shrink-0 flex-wrap items-center justify-between gap-5 border-b border-line bg-bar px-[18px] py-3">
		<div class="flex min-w-0 flex-wrap items-baseline gap-3">
			<span class="text-[14px] font-medium whitespace-nowrap text-ink">{a.name}</span>
			<span class="rounded-xs px-1.5 py-px text-[11px] tracking-[0.05em] {statusPill(status)}">{status}</span>
			<span class="text-[11.5px] text-faint">
				{a.def === "radius" ? (radius / 1000).toFixed(1) + " km radius · " + sqkm.toFixed(0) + " km²" : "relation/" + a.rel + " · " + sqkm + " km²"}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<button
				class="cursor-pointer rounded-sm border border-line bg-transparent px-[11px] py-1 text-[12px] text-muted hover:text-ink"
				onclick={() => review.editArea(a)}>edit</button
			>
			<button class={ghost(paused)} onclick={() => review.togglePaused(a)}>{paused ? "resume" : "pause"}</button>
			<button
				class="cursor-pointer rounded-sm border border-edge-strong bg-raised px-[11px] py-1 text-[12px] whitespace-nowrap text-ink"
				onclick={() => goto("/")}>run pipeline now</button
			>
		</div>
	</div>

	<AreaMap class="h-[200px] shrink-0 border-b border-line bg-bar lg:h-auto lg:min-h-[190px] lg:flex-1" />

	<MetricTiles {tiles} />

	<div class="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(330px,1fr))]">
		<div class="min-w-0 border-r border-b border-line-soft">
			<div class="border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted">SOURCES IN THIS AREA</div>
			{#each review.sources as s (s.id)}
				{@const on = !!review.links[s.id + ":" + a.id]}
				{@const en = !!review.enabled[s.id]}
				{@const y = review.yieldFor(s.id, a.id)}
				{@const tone = !en ? "off" : healthTone(review.fixed[s.id] ? "ok" : s.health)}
				<div class="grid grid-cols-[26px_minmax(0,1fr)_104px_86px] items-center gap-2 border-b border-line-faint px-4 py-[9px] text-[12.5px]">
					<button class={boxBtn(on)} onclick={() => review.toggleLink(s.id, a.id)}>{on ? "[x]" : "[ ]"}</button>
					<span class="truncate {on ? 'text-ink' : 'text-faint'}">{s.name}</span>
					<span class="text-[11.5px] text-faint">{on && y ? y[0] + " cand" : on ? "no runs yet" : "—"}</span>
					<span
						class="text-[11.5px] {!on
							? 'text-faint'
							: tone === 'off'
								? 'text-faint'
								: tone === 'ok'
									? 'text-ok'
									: tone === 'warn'
										? 'text-warn'
										: 'text-bad'}"
					>
						{on ? (tone === "off" ? "disabled" : tone === "ok" ? "ok" : tone === "warn" ? "warn" : "failing") : "—"}
					</span>
				</div>
			{/each}
			<div class="px-4 py-[9px] text-[11px] leading-normal text-faint">
				Sources are global. Switching one off here stops it for {a.name} only — its config and other areas are untouched.
			</div>
		</div>

		<div class="min-w-0 border-b border-line-soft">
			<div class="border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted">BOUNDARY</div>
			<div class="grid grid-cols-[116px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 px-4 py-3 text-[12.5px]">
				{#each defRows as r (r[0])}
					<span class="text-[11px] text-muted">{r[0]}</span>
					<span class="min-w-0 break-words {r[2] === 'code' ? 'text-accent' : 'text-ink'}">{r[1]}</span>
				{/each}
			</div>

			{#if a.def === "radius"}
				<div class="flex flex-wrap items-center gap-3 px-4 pb-[14px]">
					<input
						type="range"
						min="250"
						max="8000"
						step="250"
						value={radius}
						class="w-[200px] accent-accent"
						oninput={(e) => review.setRadius(a, parseInt(e.currentTarget.value, 10))}
						onchange={() => review.saveRadius(a)}
					/>
					<span class="text-[12.5px] text-ink">{(radius / 1000).toFixed(2)} km · {sqkm.toFixed(0)} km²</span>
				</div>
			{/if}

			<div class="px-4 pb-[14px] text-[11px] leading-[1.55] text-faint">
				{a.def === "radius"
					? "Candidates are filtered by bounding box, then point-in-circle. A POI that falls outside after a radius change keeps its review history."
					: "The boundary follows the relation on OSM. If mappers redraw it, the next run re-scopes the queue."}
			</div>

			<div class="px-4 pb-4">
				<button
					class="cursor-pointer rounded-sm border border-[#43312e] bg-transparent px-[11px] py-1 text-[12px] text-bad"
					onclick={() => review.removeArea(a)}>remove area</button
				>
				<span class="ml-2.5 text-[11px] text-faint">
					{a.pending ? a.pending + " pending candidates would be discarded" : "nothing pending — safe to remove"}
				</span>
			</div>
		</div>
	</div>
</div>
