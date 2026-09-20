<script lang="ts">
// One saved source: what it is configured to fetch, which areas use it, and
// what its last four runs did.

import MetricTiles from "$lib/components/MetricTiles.svelte";
import { boxBtn, ghost, num } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { Tone } from "$lib/types";

const s = $derived(review.source(review.srcId));
const fixed = $derived(!!review.fixed[s.id]);
const started = $derived(!!review.started[s.id]);
const en = $derived(!!review.enabled[s.id]);
const floor = $derived(review.floors[s.id] ?? s.floor);

/** Replacing the rejected key rewrites the three rows that referenced it. */
const config = $derived(
	s.config.map((r) => {
		let [label, value, type] = [r[0], r[1], r[2]];
		if (fixed && type === "bad") {
			value = "••••••••••••a10c · added 14-09-2026";
			type = undefined;
		}
		if (fixed && label === "next run") value = "16-09-2026 05:00";
		if (fixed && label === "schedule") {
			value = "weekly · Wed 05:00";
			type = undefined;
		}
		return { label, value, type };
	}),
);

const tiles = $derived(
	s.metrics.map((m) => ({
		label: m[0],
		value: fixed && m[0] === "errors" ? "0" : m[1],
		sub: fixed && m[0] === "errors" ? "key replaced" : m[2],
		tone: (fixed && m[3] === "bad" ? "ok" : (m[3] ?? null)) as Tone,
	})),
);

const runs = $derived([
	...(started
		? [
				{
					when: "now",
					dur: "—",
					fetched: "—",
					cands: "—",
					errors: "—",
					result: "queued · starting",
				},
			]
		: []),
	...s.runs,
]);

const runCols = "grid grid-cols-[136px_66px_88px_96px_74px_minmax(0,1fr)]";
</script>

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
			<button
				class="cursor-pointer rounded-sm border border-edge-strong bg-raised px-[11px] py-1 text-[12px] whitespace-nowrap text-ink"
				onclick={() => (s.failing && !fixed ? review.repair(s.id) : review.runNow(s.id))}>run now</button
			>
		</div>
	</div>

	{#if s.failing && !fixed}
		<div class="border-b border-bad-line bg-bad-bg px-[18px] py-[11px]">
			<div class="flex flex-wrap items-center gap-2.5 text-[12px] text-bad">
				<span class="rounded-xs bg-bad px-1.5 py-px font-semibold tracking-[0.05em] text-bg">AUTH FAILED</span>
				<span class="text-ink">HTTP 401 on the last 3 runs — API key rejected</span>
			</div>
			<div class="mt-[7px] text-[12px] text-warn-ink">
				No candidates have entered the queue from this source since 27-08-2026. Existing candidates are unaffected.
			</div>
			<div class="mt-[9px] flex flex-wrap gap-2">
				<button
					class="cursor-pointer rounded-sm border-0 bg-accent px-3 py-1 text-[12px] font-semibold text-accent-ink"
					onclick={() => review.repair(s.id)}>replace key</button
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
				{#each config as r (r.label)}
					<span class="text-[11px] text-muted">{r.label}</span>
					<span
						class="min-w-0 break-words {r.type === 'bad' ? 'text-bad' : r.type === 'warn' ? 'text-warn-ink' : 'text-ink'} {r.type ===
						'code'
							? 'text-[12px]'
							: ''}">{r.value}</span
					>
				{/each}
				<span class="text-[11px] text-muted">confidence floor</span>
				<span class="flex flex-wrap items-center gap-2.5">
					<input
						type="range"
						min="0"
						max="0.9"
						step="0.05"
						value={floor}
						class="w-[130px] accent-accent"
						oninput={(e) => review.setFloor(s.id, parseFloat(e.currentTarget.value))}
						onchange={() => review.saveFloor(s.id)}
					/>
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
					<button
						class="cursor-pointer rounded-xs border border-dashed border-edge bg-transparent px-[7px] py-0.5 text-[11.5px] text-faint hover:text-ink"
						onclick={() => review.editSource(s)}>+ key</button
					>
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
			{#each review.visibleAreas as a (a.id)}
				{@const on = !!review.links[s.id + ":" + a.id]}
				{@const y = review.yieldFor(s.id, a.id)}
				<div class="grid grid-cols-[26px_minmax(0,1fr)_96px_74px] items-center gap-2 border-b border-line-faint px-4 py-2 text-[12.5px]">
					<button class={boxBtn(on)} onclick={() => review.toggleLink(s.id, a.id)}>{on ? "[x]" : "[ ]"}</button>
					<span class="truncate {on ? 'text-ink' : 'text-faint'}">{a.name}</span>
					<span class="text-[11.5px] text-faint">{on && y ? y[0] + " cand" : on ? "no runs yet" : "—"}</span>
					<span
						class="text-[11.5px] {on && y ? (y[1] >= 0.75 ? 'text-ok' : y[1] >= 0.6 ? 'text-warn' : 'text-bad') : 'text-faint'}"
						>{on && y ? Math.round(y[1] * 100) + "% acc" : "—"}</span
					>
				</div>
			{/each}
			<div class="px-4 py-[9px] text-[11px] text-faint">Enabling an area backfills the last 30 days on its next run.</div>
		</div>
	</div>

	<div>
		<div class="border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted">RECENT RUNS</div>
		<div class="max-md:overflow-x-auto">
			<div class="max-md:min-w-[620px]">
				<div class="{runCols} border-b border-line-faint px-4 py-[7px] font-sans text-[10.5px] tracking-[0.07em] text-faint">
					<span>WHEN</span><span>DUR</span><span>FETCHED</span><span>CANDIDATES</span><span>ERRORS</span><span>RESULT</span>
				</div>
				{#each runs as r, i (r.when + i)}
					{@const errors = fixed ? "0" : r.errors}
					{@const result = fixed && r.result !== "ok" ? "ok · key replaced" : r.result}
					<div class="{runCols} items-baseline border-b border-line-faint px-4 py-2 text-[12.5px]">
						<span class="text-ink-2">{r.when}</span>
						<span class="text-faint">{r.dur}</span>
						<span class="text-faint">{r.fetched}</span>
						<span class="text-ink">{r.cands}</span>
						<span class={num(errors) > 0 ? "text-warn" : "text-faint"}>{errors}</span>
						<span class="truncate {/401|fail/.test(result) ? 'text-bad' : /queued/.test(result) ? 'text-warn' : 'text-faint'}"
							>{result}</span
						>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
