<script lang="ts">
import { healthTone, railAdd, railRow, toneDot } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Source } from "$lib/types";

const overviewOn = $derived(!review.srcId && !review.srcDraft);

function meta(s: Source) {
	const linked = review.visibleAreas.filter((a) => review.links[s.id + ":" + a.id]).length;
	const areaLabel = linked + (linked === 1 ? " area" : " areas");
	if (!review.enabled[s.id]) return areaLabel + " · disabled";
	if (!s.runs[0] || s.runs[0].when === "queued") return areaLabel + " · first run queued";
	const mv = (label: string) => String(review.metric(s, label)[1]);
	return areaLabel + " · " + mv("candidates") + " cand · " + mv("errors") + " err";
}
</script>

<div
	class="sticky top-0 z-1 flex items-center justify-between gap-2.5 border-b border-line-soft bg-head py-1.5 pr-2.5 pl-[14px] font-sans text-[10.5px] tracking-[0.08em] text-muted"
>
	<span class="whitespace-nowrap">SOURCES · {review.sources.length}</span>
	<button class={railAdd(true)} onclick={() => review.newSource()}>+ new source</button>
</div>

<button
	class={railRow(overviewOn)}
	onclick={() => {
		review.srcId = null;
		review.srcDraft = null;
	}}
>
	<div class="text-[12.5px] {overviewOn ? 'text-ink' : 'text-ink-2'}">All sources</div>
	<div class="mt-1 text-[11px] text-faint">{review.sources.length} sources · aggregate</div>
</button>

{#each review.sources as s (s.id)}
	{@const on = s.id === review.srcId && (!review.srcDraft || review.srcDraft.editId === s.id)}
	{@const en = !!review.enabled[s.id]}
	<button
		class={railRow(on)}
		onclick={() => {
			review.srcId = s.id;
			review.srcDraft = null;
		}}
	>
		<div class="flex min-w-0 items-center gap-2">
			<span class="block h-[7px] w-[7px] shrink-0 rounded-full {en ? toneDot(healthTone(s.health)) : 'bg-dim'}"
			></span>
			<span class="truncate text-[12.5px] {on ? 'text-ink' : en ? 'text-ink-2' : 'text-faint'}">{s.name}</span>
		</div>
		<div class="mt-1 truncate pl-4 text-[11px] text-faint">{meta(s)}</div>
	</button>
{/each}
