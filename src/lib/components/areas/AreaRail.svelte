<script lang="ts">
import { railAdd, railRow, statusText } from "$lib/format";
import { review } from "$lib/stores/review.svelte";

const overviewOn = $derived(!review.areaId && !review.draft);
</script>

<div
	class="sticky top-0 z-1 flex items-center justify-between gap-2.5 border-b border-line-soft bg-head py-1.5 pr-2.5 pl-[14px] font-sans text-[10.5px] tracking-[0.08em] text-muted"
>
	<span class="whitespace-nowrap">AREAS · {review.visibleAreas.length}</span>
	<button class={railAdd(true)} onclick={() => review.newArea()}>+ new area</button>
</div>

<button
	class={railRow(overviewOn)}
	onclick={() => {
		review.areaId = null;
		review.draft = null;
		review.areaCard = null;
	}}
>
	<div class="text-[12.5px] {overviewOn ? 'text-ink' : 'text-ink-2'}">All areas</div>
	<div class="mt-1 text-[11px] text-faint">{review.visibleAreas.length} areas · aggregate</div>
</button>

{#each review.visibleAreas as a (a.id)}
	{@const on = a.id === review.areaId && (!review.draft || review.draft.editId === a.id)}
	{@const st = review.paused[a.id] ? "disabled" : a.status}
	<button
		class={railRow(on)}
		onclick={() => {
			review.areaId = a.id;
			review.draft = null;
		}}
	>
		<div class="flex min-w-0 items-center justify-between gap-2">
			<span class="truncate text-[12.5px] {on ? 'text-ink' : 'text-ink-2'}">{a.name}</span>
			<span class="shrink-0 text-[10.5px] tracking-[0.04em] {statusText(st)}">{st === "first run queued" ? "queued" : st}</span>
		</div>
		<div class="mt-1 truncate text-[11px] text-faint">
			{a.def === "radius" ? (review.radiusOf(a) / 1000).toFixed(1) + " km radius" : "relation/" + a.rel} · {a.pending} pending · {review.sourceCount(
				a
			)} src
		</div>
	</button>
{/each}
