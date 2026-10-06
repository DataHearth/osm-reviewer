<script lang="ts">
// One saved source: what it is configured to fetch, which areas use it, and
// what its last four runs did.

import Bar from "$lib/components/Bar.svelte";
import MetricTiles from "$lib/components/MetricTiles.svelte";
import RunButton from "$lib/components/RunButton.svelte";
import { INERT_BTN, num } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Tone } from "$lib/types";

const s = $derived(review.source(review.srcId));
const en = $derived(!!review.enabled[s.id]);
const floor = $derived(s.floor);

const tiles = $derived(
	s.metrics.map((m) => ({ label: m[0], value: m[1], sub: m[2], tone: (m[3] ?? null) as Tone })),
);

// Runs come newest first, so the failures at the head are the current streak.
const streak = $derived.by(() => {
	const i = s.runs.findIndex((r) => r.result.startsWith("ok"));
	return i === -1 ? s.runs.length : i;
});
const lastOk = $derived(s.runs.find((r) => r.result.startsWith("ok")));

const renameCols =
	"grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2.5 lg:grid-cols-[192px_minmax(0,1fr)] lg:gap-x-3";
const IGNORED_OPEN = 5;
const runCols = "grid grid-cols-[136px_66px_88px_96px_74px_minmax(0,1fr)]";
</script>

{#snippet renameRow(column: string, readAs: string, dim = false)}
	<div class="{renameCols} items-baseline border-b border-line-faint px-4 py-2 text-[12.5px]">
		<span class="truncate {dim ? 'text-faint' : 'text-ink-2'}" title={column}>{column}</span>
		<span class="min-w-0 break-words {dim ? 'text-faint' : 'text-ink'}">{readAs}</span>
	</div>
{/snippet}

<div>
	<div class="flex flex-wrap items-center justify-between gap-5 border-b border-line bg-bar px-[18px] py-3">
		<div class="flex min-w-0 flex-wrap items-baseline gap-3">
			<span class="text-[14px] font-medium whitespace-nowrap text-ink">{s.name}</span>
			<span class="text-[11.5px] text-faint">{s.kindLabel}</span>
		</div>
		<div class="flex items-center gap-2">
			<button
				class="cursor-pointer rounded-sm border border-edge-strong bg-bar px-[11px] py-1 text-[12px] whitespace-nowrap text-ink-2 hover:border-dim hover:text-ink"
				onclick={() => review.editSource(s)}>edit</button
			>
			<button
				class="cursor-pointer rounded-sm px-[11px] py-1 text-[12px] whitespace-nowrap {en
					? 'border border-ok-line bg-ok-bg text-ok-ink'
					: 'border border-line bg-raised text-faint'}"
				onclick={() => review.toggleEnabled(s)}>{en ? "enabled" : "disabled"}</button
			>
			{#key s.id}
				<RunButton label="run now" name={s.name} running={s.running} onrun={() => review.runNow(s)} />
			{/key}
		</div>
	</div>

	{#if s.failing}
		<div class="border-b border-bad-line bg-bad-bg px-[18px] py-[11px]">
			<div class="flex flex-wrap items-center gap-2.5 text-[12px] text-bad">
				<span class="rounded-xs bg-bad px-1.5 py-px font-semibold tracking-[0.05em] text-bg">FAILING</span>
				<span class="text-ink">{s.runs[0]?.result ?? "no run recorded"} on the last {streak === 1 ? "run" : streak + " runs"}</span>
			</div>
			<div class="mt-[7px] text-[12px] text-warn-ink">
				{lastOk
					? "No candidates have entered the queue from this source since " + lastOk.when.slice(0, 10) + "."
					: "No run of this source has succeeded yet."} Existing candidates are unaffected.
			</div>
			<div class="mt-[9px] flex flex-wrap gap-2">
				<button
					class="cursor-pointer rounded-sm border-0 bg-accent px-3 py-1 text-[12px] font-semibold text-accent-ink"
					onclick={() => review.editSource(s)}>replace key</button
				>
				<button
					class="cursor-pointer rounded-sm border border-line bg-transparent px-3 py-1 text-[12px] text-faint hover:text-ink"
					onclick={() => review.toggleEnabled(s)}>disable source</button
				>
			</div>
		</div>
	{/if}

	<MetricTiles {tiles} />

	<div class="grid grid-cols-[repeat(auto-fit,minmax(330px,1fr))]">
		<div class="min-w-0 border-r border-b border-line-soft">
			<div class="border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted">CONFIGURATION</div>
			<div class="grid grid-cols-[124px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 px-4 py-3 text-[12.5px]">
				{#each s.config as [label, value, type] (label)}
					<span class="text-[11px] text-muted">{label}</span>
					<span
						class="min-w-0 break-words {type === 'bad' ? 'text-bad' : type === 'warn' ? 'text-warn-ink' : 'text-ink'} {type ===
						'code'
							? 'text-[12px]'
							: ''}">{value}</span
					>
				{/each}
				<span class="text-[11px] text-muted">confidence floor</span>
				<span class="flex flex-wrap items-center gap-2.5">
					<Bar value={floor} max={0.9} label="confidence floor" class="w-[130px]" />
					<span class="text-ink">{floor.toFixed(2)}</span>
					<span class="text-[11px] text-faint">
						auto-discards {floor >= 0.7 ? "aggressively" : floor >= 0.55 ? "moderately" : "little"}
					</span>
				</span>
			</div>
			<div class="px-4 pb-[14px]">
				<div class="mb-1.5 text-[11px] text-muted">tag allowlist — keys this source may write</div>
				<div class="flex flex-wrap gap-[5px]">
					{#each s.allow as k (k)}
						<span class="rounded-xs border border-line bg-bar px-[7px] py-0.5 text-[11.5px] text-ink-2">{k}</span>
					{/each}
				</div>
				<div class="mt-[7px] text-[11px] leading-normal text-faint">
					Anything outside the allowlist is dropped at extraction, before it reaches the queue.
				</div>
			</div>
		</div>

		<div class="min-w-0 border-b border-line-soft">
			<div class="border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted">
				AREAS USING THIS SOURCE
			</div>
			{#each review.areas as a (a.id)}
				{@const on = !!review.links[s.id + ":" + a.id]}
				{@const y = review.yieldFor(s.id, a.id)}
				<div class="grid grid-cols-[26px_minmax(0,1fr)_96px_74px] items-center gap-2 border-b border-line-faint px-4 py-2 text-[12.5px]">
					<span class="text-[12.5px] {on ? 'text-accent' : 'text-faint'}">{on ? "[x]" : "[ ]"}</span>
					<span class="truncate {on ? 'text-ink' : 'text-faint'}">{a.name}</span>
					<span class="text-[11.5px] text-faint">{on && y ? y[0] + " cand" : on ? "no runs yet" : "—"}</span>
					<span
						class="text-[11.5px] {on && y?.[1] != null ? (y[1] >= 0.75 ? 'text-ok' : y[1] >= 0.6 ? 'text-warn' : 'text-bad') : 'text-faint'}"
						>{on && y?.[1] != null ? Math.round(y[1] * 100) + "% acc" : "—"}</span
					>
				</div>
			{/each}
			<div class="px-4 py-[9px] text-[11px] text-faint">Enabling an area backfills the last 30 days on its next run.</div>
		</div>
	</div>

	{#if s.columnMapping}
		{@const cm = s.columnMapping}
		<div class="border-b border-line-soft">
			<div class="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-[9px]">
				<span class="font-sans text-[10.5px] tracking-[0.08em] text-muted">COLUMN MAPPING</span>
				{#if cm.refusal}
					<button class={INERT_BTN} disabled title={cm.refusal.reason}>rename again · {cm.refusal.label}</button>
				{:else}
					{#key s.id}
						<RunButton label="rename again" name={s.name} running={s.running} watch={false} onrun={() => review.renameAgain(s)} />
					{/key}
				{/if}
			</div>
			<div class="grid grid-cols-[124px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 px-4 py-3 text-[12.5px] lg:grid-cols-[192px_minmax(0,1fr)]">
				<span class="text-[11px] text-muted">mapping</span>
				<span class="min-w-0 break-words text-ink">
					{#if cm.title}
						{cm.title} <span class="text-[12px] text-faint">{cm.mapping}</span>
					{:else}
						<span class="text-warn-ink">mapping {cm.mapping} is no longer shipped</span>
					{/if}
				</span>
				<span class="text-[11px] text-muted">columns</span>
				<span class="text-ink">
					{#if cm.stored}
						renamed by {cm.stored.model} · <span class="whitespace-nowrap">{cm.stored.madeAt}</span>
					{:else if cm.origin === "shipped"}
						shipped with the app{cm.shippedColumns ? ` · ${cm.shippedColumns} columns` : ""}
					{:else}
						<span class="text-faint">not read yet</span>
					{/if}
				</span>
				{#if cm.renameRequested}
					<span class="text-[11px] text-muted">pending</span>
					<span class="text-warn-ink">renamed again on the next run</span>
				{/if}
			</div>
			{#if cm.stored}
				{@const st = cm.stored}
				<div class="{renameCols} border-b border-line-faint px-4 py-[7px] font-sans text-[10.5px] tracking-[0.07em] text-faint">
					<span>COLUMN</span><span>READ AS</span>
				</div>
				{#each st.renamed as [column, input] (column)}
					{@render renameRow(column, input)}
				{/each}
				{#each st.steps as [column, step, as] (column)}
					{@render renameRow(column, `step ${step}, as ${as}`)}
				{/each}
				{#if st.ignored.length > 0}
					<details class="group m-disclose" open={st.ignored.length <= IGNORED_OPEN}>
						<summary class="flex cursor-pointer list-none items-center gap-2 border-b border-line-faint px-4 py-2 text-[12px] text-muted [&::-webkit-details-marker]:hidden">
							<span class="shrink-0 text-[11px] text-faint m-turn group-open:rotate-90">›</span>
							{st.ignored.length} ignored
						</summary>
						{#each st.ignored as [column, reason] (column)}
							{@render renameRow(column, `ignored — ${reason}`, true)}
						{/each}
					</details>
				{/if}
				<div class="px-4 py-[9px] text-[11px] text-faint">
					Made for exactly these {st.columns} columns; a read with another list is renamed again.
				</div>
			{/if}
		</div>
	{/if}

	<div>
		<div class="border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted">RECENT RUNS</div>
		<div class="max-md:overflow-x-auto">
			<div class="max-md:min-w-[620px]">
				<div class="{runCols} border-b border-line-faint px-4 py-[7px] font-sans text-[10.5px] tracking-[0.07em] text-faint">
					<span>WHEN</span><span>DUR</span><span>FETCHED</span><span>CANDIDATES</span><span>ERRORS</span><span>RESULT</span>
				</div>
				{#each s.runs as r, i (r.when + i)}
					<div class="{runCols} items-baseline border-b border-line-faint px-4 py-2 text-[12.5px]">
						<span class="text-ink-2">{r.when}</span>
						<span class="text-faint">{r.dur}</span>
						<span class="text-faint">{r.fetched}</span>
						<span class="text-ink">{r.cands}</span>
						<span class={num(r.errors) > 0 ? "text-warn" : "text-faint"}>{r.errors}</span>
						<span class="truncate {/401|fail/.test(r.result) ? 'text-bad' : 'text-faint'}"
							>{r.result}</span
						>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
