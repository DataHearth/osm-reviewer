<script lang="ts">
import { goto } from "$app/navigation";
import QueueFilterSheet from "$lib/components/QueueFilterSheet.svelte";
import { confBg, confText, OP_SIGN, typeLabel, typeText } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Candidate } from "$lib/types";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// A row has too many fields to line up in columns at 402px, so phone gets
// cards and md gets the table. Both are rendered and the CSS breakpoint
// picks one, rather than a JS width read choosing which to mount.
const rows = $derived(review.visible);
let sheet = $state(false);

const chip = (on: boolean) =>
	"cursor-pointer rounded-full whitespace-nowrap px-[10px] py-[3px] text-[11.5px] " +
	(on
		? "border border-edge-strong bg-line text-accent"
		: "border border-edge-soft bg-transparent text-faint hover:text-ink");

const types = ["all", "new", "update", "closure"] as const;
const confs = [
	["all", "all"],
	["high", "≥.85"],
	["mid", ".60–.85"],
	["low", "<.60"],
] as const;

const headers = [
	["type", "TYPE"],
	["name", "OBJECT"],
	["tags", "TAGS"],
	["source", "SOURCE"],
	["conf", "CONF"],
	["age", "AGE"],
	["flags", "FLAGS"],
] as const;

const cols =
	"grid items-center grid-cols-[22px_78px_minmax(0,1fr)_140px_74px_70px_46px_84px] " +
	"lg:grid-cols-[26px_92px_minmax(0,1fr)_210px_96px_74px_62px_90px]";

const filterLabel = $derived(
	[
		review.typeFilter === "all" ? null : review.typeFilter,
		review.confFilter === "all" ? null : "conf " + review.confFilter,
	]
		.filter(Boolean)
		.join(" · ") || "all candidates",
);

function flag(c: Candidate): [string, string] {
	if (c.conflict) return ["conflict", "text-bad"];
	if (c.hasInvalid) return ["invalid", "text-bad"];
	if (c.allQuarantined) return ["quarantined", "text-bad"];
	if (c.hasNoEv) return ["1 unevidenced", "text-warn-ink"];
	if (c.stale) return ["stale " + c.stale + "d", "text-warn"];
	return ["—", "text-faint"];
}

function openRow(c: Candidate, i: number) {
	review.open(c, i);
	goto("/review");
}
</script>

<section class="flex min-h-0 flex-1 flex-col">
	{#if review.empty}
		<div class="m-fade flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-10 md:py-14">
			<div class="w-full max-w-[560px] overflow-hidden rounded-lg border border-line bg-panel">
				<div class="border-b border-line px-[14px] py-[10px] text-[12px] tracking-[0.06em] text-ok">QUEUE EMPTY</div>
				<div class="flex flex-col gap-[10px] px-[14px] py-4 text-[13px] leading-relaxed">
					<div class="text-ink">Nothing pending. Everything the pipeline found has been reviewed.</div>
					<div class="grid gap-x-3 gap-y-0.5 text-[12px] text-muted max-md:gap-y-2 md:grid-cols-[170px_1fr]">
						<span class="max-md:text-faint">last pipeline run</span><span>{data.pipeline.lastRun} · 8 min</span>
						<span class="max-md:text-faint">candidates discovered</span><span>0 new, {review.total} already queued</span>
						<span class="max-md:text-faint">next run</span><span>{data.pipeline.nextRun}</span>
						<span class="max-md:text-faint">sources polled</span><span>sirene, website-crawl, data.toulouse-metropole</span>
					</div>
					<div class="mt-1 flex gap-2 max-md:flex-col">
						<button
							class="cursor-pointer rounded-sm border border-edge bg-raised px-3 py-[5px] text-ink max-md:min-h-[46px]"
							onclick={() => goto("/history")}>history</button
						>
						<button
							class="cursor-pointer rounded-sm border border-line bg-transparent px-3 py-[5px] text-faint hover:text-ink max-md:min-h-[46px]"
							onclick={() => review.dismissEmpty()}>refill demo queue</button
						>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- Phone: filters and sort collapse into one summary button. -->
		<div class="flex shrink-0 items-center gap-2 border-b border-line-soft bg-panel px-3 py-2 md:hidden">
			<button
				class="flex min-h-[40px] flex-1 cursor-pointer items-center gap-2 rounded-md border border-edge-soft bg-transparent px-3 text-left text-[12px] text-muted"
				onclick={() => (sheet = true)}
			>
				<span class="text-faint">filter</span>
				<span class="truncate text-ink">{filterLabel}</span>
				<span class="ml-auto text-[10px] text-faint">▾</span>
			</button>
			<span class="shrink-0 text-[11.5px] tabular-nums text-faint">{rows.length}</span>
		</div>

		<div class="hidden shrink-0 flex-wrap items-center gap-[14px] border-b border-line-soft bg-panel px-4 py-[10px] md:flex">
			<span class="text-[11px] text-faint">type</span>
			{#each types as t (t)}
				<button
					class={chip(review.typeFilter === t)}
					onclick={() => {
						review.typeFilter = t;
						review.qIdx = 0;
					}}>{t}</button
				>
			{/each}
			<span class="h-4 w-px bg-line"></span>
			<span class="text-[11px] text-faint">conf</span>
			{#each confs as c (c[0])}
				<button
					class={chip(review.confFilter === c[0])}
					onclick={() => {
						review.confFilter = c[0];
						review.qIdx = 0;
					}}>{c[1]}</button
				>
			{/each}
			<span class="ml-auto text-[11px] whitespace-nowrap text-faint">
				{rows.length} shown · {review.pendingCount} pending · area: {data.area?.name ?? "—"}
			</span>
		</div>

		<div class="flex min-h-0 flex-1 flex-col">
			<div class="min-h-0 flex-1 overflow-y-auto">
				<div class="md:hidden">
					{#each rows as c, i (c.id)}
						{@const f = flag(c)}
						<button
							type="button"
							class="flex w-full cursor-pointer flex-col gap-[7px] border-b border-line-row px-[14px] py-[13px] text-left {i ===
							review.qIdx
								? 'bg-sel shadow-[inset_2px_0_0_var(--accent)]'
								: 'bg-transparent'}"
							onclick={() => openRow(c, i)}
						>
							<div class="flex items-baseline gap-2">
								<b class="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{c.name}</b>
								<span class="shrink-0 text-[12.5px] tabular-nums {confText(c.conf)}">{c.conf.toFixed(2)}</span>
							</div>
							<div class="flex items-center gap-2 text-[11.5px]">
								<span class="rounded-xs bg-raised px-[6px] py-px {typeText(c.type)}">{typeLabel(c.type)}</span>
								<span class="truncate text-faint">{c.source}</span>
								<span class="ml-auto shrink-0 {c.stale ? 'text-warn' : 'text-faint'}">{c.age}</span>
							</div>
							<div class="truncate text-[12px] text-faint">{c.tags.map((t) => OP_SIGN[t.op] + t.k).join(" ")}</div>
							{#if f[0] !== "—"}
								<div class="text-[11.5px] {f[1]}">{f[0]}</div>
							{/if}
						</button>
					{/each}
					<div class="px-[14px] py-3 text-[11px] text-faint">
						{rows.length} of {review.total} · {review.pendingCount} pending
					</div>
				</div>

				<div class="max-md:hidden">
					<div
						class="sticky top-0 z-1 border-b border-line-soft bg-head px-4 py-2 font-sans text-[10.5px] tracking-[0.08em] text-muted {cols}"
					>
						<span></span>
						{#each headers as h (h[0])}
							<button
								title="sort"
								class="flex cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-left font-sans text-[10.5px] tracking-[0.08em] whitespace-nowrap {review.sortKey ===
								h[0]
									? 'text-accent'
									: 'text-muted'}"
								onclick={() => review.sortBy(h[0])}
							>
								{h[1]}<span class="text-[9px] leading-none"
									>{review.sortKey === h[0] ? (review.sortDir === "asc" ? "▲" : "▼") : ""}</span
								>
							</button>
						{/each}
					</div>

					{#each rows as c, i (c.id)}
						{@const on = i === review.qIdx}
						{@const f = flag(c)}
						<button
							type="button"
							class="w-full cursor-pointer border-b border-line-row px-4 py-[9px] text-left {cols}
							{on ? 'bg-sel shadow-[inset_2px_0_0_var(--accent)]' : 'bg-transparent hover:bg-panel'}"
							onclick={() => openRow(c, i)}
						>
							<span class="text-[11px] text-accent">{on ? "›" : ""}</span>
							<span class="text-[12px] {typeText(c.type)}">{typeLabel(c.type)}</span>
							<span class="truncate pr-3">
								<b class="font-medium text-ink">{c.name}</b> <span class="text-faint">{c.osmId}</span>
							</span>
							<span class="truncate pr-3 text-[12px] text-faint">
								{c.tags.map((t) => OP_SIGN[t.op] + t.k).join(" ")}
							</span>
							<span class="truncate text-[12px] text-faint">{c.source}</span>
							<span class="flex items-center gap-1.5 pr-2.5">
								<span class="block h-[5px] w-7 rounded-[3px] bg-line">
									<span class="block h-[5px] rounded-[3px] {confBg(c.conf)}" style="width: {Math.round(c.conf * 28)}px"></span>
								</span>
								<span class="text-[12px] {confText(c.conf)}">{c.conf.toFixed(2)}</span>
							</span>
							<span class="pr-2 text-[12px] {c.stale ? 'text-warn' : 'text-faint'}">{c.age}</span>
							<span class="truncate text-[11.5px] {f[1]}">{f[0]}</span>
						</button>
					{/each}
				</div>
			</div>

			<footer class="hidden shrink-0 border-t border-line-soft px-4 py-[9px] text-[11px] text-faint md:block">
				rows 1–{rows.length} of {review.total}<span class="hidden lg:inline"> · j/k move · enter open · esc back</span>
			</footer>
		</div>

		<QueueFilterSheet bind:open={sheet} />
	{/if}
</section>
