<script lang="ts">
// Every enabled source at once: the aggregate the operator checks first, and
// the interleaved run log that says which one stopped delivering.

import MetricTiles from "$lib/components/MetricTiles.svelte";
import { comma, healthTone, num, stampKey, toneDot } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Tone } from "$lib/types";

const reviewed = (sub: string | undefined) => {
	const m = String(sub).match(/([\d,]+)\s+reviewed/);
	return m ? num(m[1]) : 0;
};

const agg = $derived.by(() => {
	let cands = 0,
		revTotal = 0,
		accWeighted = 0,
		unevWeighted = 0,
		errs = 0;
	for (const s of review.sources) {
		if (!review.enabled[s.id]) continue;
		const rev = reviewed(review.metric(s, "accept rate")[2]);
		cands += num(review.metric(s, "candidates")[1]);
		revTotal += rev;
		accWeighted += num(review.metric(s, "accept rate")[1]) * rev;
		unevWeighted += num(review.metric(s, "unevidenced")[1]) * rev;
		errs += num(review.metric(s, "errors")[1]);
	}
	return {
		cands,
		revTotal,
		errs,
		accept: revTotal ? accWeighted / revTotal : 0,
		uneviden: revTotal ? unevWeighted / revTotal : 0,
	};
});

const enabledCount = $derived(review.sources.filter((s) => review.enabled[s.id]).length);
const failing = $derived(review.sources.filter((s) => s.failing && review.enabled[s.id]).length);

const tiles = $derived([
	{
		label: "sources",
		value: `${enabledCount} of ${review.sources.length}`,
		sub:
			enabledCount === review.sources.length
				? "all enabled"
				: `${review.sources.length - enabledCount} disabled`,
		tone: (enabledCount === review.sources.length ? "ok" : "warn") as Tone,
	},
	{ label: "candidates", value: comma(agg.cands), sub: "last run of each source" },
	{
		label: "accept rate",
		value: `${agg.accept.toFixed(0)}%`,
		sub: `of ${comma(agg.revTotal)} reviewed`,
		tone: (agg.accept >= 70 ? "ok" : "warn") as Tone,
	},
	{
		label: "unevidenced",
		value: `${agg.uneviden.toFixed(1)}%`,
		sub: "tags without a source row",
		tone: (agg.uneviden <= 5 ? "ok" : "warn") as Tone,
	},
	{
		label: "errors",
		value: comma(agg.errs),
		sub: agg.errs ? "across enabled sources" : "clean",
		tone: (agg.errs ? "warn" : "ok") as Tone,
	},
]);

const runs = $derived.by(() => {
	const log: {
		id: string;
		t: number;
		when: string;
		name: string;
		fetched: string;
		cands: string;
		errors: string;
		result: string;
		tone: Tone;
	}[] = [];
	for (const s of review.sources) {
		if (!review.enabled[s.id]) continue;
		for (const r of s.runs) {
			const tone: Tone =
				num(r.errors) > 0 ? (/401|unauthor|fail/i.test(r.result) ? "bad" : "warn") : "ok";
			log.push({
				id: s.id,
				t: stampKey(r.when),
				when: r.when,
				name: s.name,
				fetched: r.fetched,
				cands: r.cands,
				errors: r.errors,
				result: r.result,
				tone,
			});
		}
	}
	return log.sort((a, b) => b.t - a.t).slice(0, 8);
});

const cols =
	"grid grid-cols-[116px_minmax(0,1.3fr)_minmax(0,1fr)_56px_66px_minmax(0,1.1fr)] gap-2.5";
</script>

<div>
	<div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-line bg-bar px-[18px] py-3">
		<span class="shrink-0 text-[14px] font-medium whitespace-nowrap text-ink">All sources</span>
		<span class="text-[12px] {failing ? 'text-bad' : 'text-faint'}">
			{#if failing}
				{failing}{failing === 1 ? " source is" : " sources are"} failing — candidates from it are not reaching the queue
			{:else}
				every enabled source delivered candidates on its last run
			{/if}
		</span>
	</div>

	<MetricTiles {tiles} />

	<div class="max-md:overflow-x-auto">
		<div class="max-md:min-w-[620px]">
			<div class="{cols} border-b border-line-faint px-4 py-2 font-sans text-[10.5px] tracking-[0.07em] text-faint">
				<span>WHEN</span><span>SOURCE</span><span>FETCHED</span><span>CAND</span><span>ERRORS</span><span>RESULT</span>
			</div>
			{#each runs as r, i (r.id + r.when + i)}
				<button
					class="{cols} w-full cursor-pointer items-center border-b border-line-faint bg-transparent px-4 py-[9px] text-left text-[12.5px] hover:bg-panel"
					onclick={() => {
						review.srcId = r.id;
						review.srcDraft = null;
					}}
				>
					<span class="text-ink-2">{r.when}</span>
					<span class="flex min-w-0 items-center gap-2">
						<span class="block h-[7px] w-[7px] shrink-0 rounded-full {toneDot(r.tone)}"></span>
						<span class="truncate text-ink">{r.name}</span>
					</span>
					<span class="truncate text-faint">{r.fetched}</span>
					<span class="text-ink">{r.cands}</span>
					<span class={num(r.errors) > 0 ? "text-warn" : "text-faint"}>{r.errors}</span>
					<span class="truncate text-[11.5px] {r.tone === 'bad' ? 'text-bad' : r.tone === 'warn' ? 'text-warn-ink' : 'text-faint'}"
						>{r.result}</span
					>
				</button>
			{/each}
		</div>
	</div>
	<div class="px-4 py-2.5 text-[11px] text-faint">
		Last {runs.length} runs across enabled sources · pick a run, or a source in the rail, for its config and full history
	</div>
</div>
