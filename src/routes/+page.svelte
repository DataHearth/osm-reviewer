<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import EmptyState from "$lib/components/EmptyState.svelte";
import QueueFilterSheet from "$lib/components/QueueFilterSheet.svelte";
import {
	CHIP,
	confBg,
	confText,
	FLAG_BAD,
	FLAG_WARN,
	KBD,
	OP_SIGN,
	pct,
	typeDot,
	typeLabel,
	typeText,
} from "$lib/format";
import { kbdLabel } from "$lib/keymap";
import { keys } from "$lib/stores/keys.svelte";
import { review } from "$lib/stores/review.svelte";
import type { Candidate } from "$lib/types";

// A row has too many fields to line up in columns at 402px, so phone gets
// cards and md gets the table. Both are rendered and the CSS breakpoint
// picks one, rather than a JS width read choosing which to mount.
const rows = $derived(review.visible);
const rowsLabel = $derived(
	rows.length
		? "Rows 1–" + rows.length + " of " + review.pendingCount
		: "No rows loaded · " + review.pendingCount + " pending",
);

const seg = (on: boolean) =>
	"cursor-pointer rounded-md border-0 px-[11px] py-1 text-[12.5px] whitespace-nowrap transition-colors " +
	(on ? "bg-raised text-ink" : "bg-transparent text-muted hover:text-ink");

const types = [
	["all", "All types"],
	["new", "New"],
	["update", "Update"],
	["closure", "Closure"],
] as const;
const confs = [
	["all", "Any confidence"],
	["high", "≥85%"],
	["mid", "60–85%"],
	["low", "<60%"],
] as const;

// Type, source and tags fold into the object column, so their sort keys sit
// in that column's header.
const objectSorts = [
	["name", "Object"],
	["type", "Type"],
	["source", "Source"],
	["tags", "Tags"],
] as const;

const cols =
	"grid items-center gap-x-[14px] grid-cols-[10px_minmax(0,1fr)_112px_92px_44px] " +
	"lg:grid-cols-[10px_minmax(0,1fr)_150px_120px_56px]";

function flag(c: Candidate): [string, string] | null {
	if (c.conflict) return ["Conflict", FLAG_BAD];
	if (c.hasInvalid) return ["Invalid", FLAG_BAD];
	if (c.allQuarantined) return ["Quarantined", FLAG_BAD];
	if (c.hasNoEv) return ["1 unevidenced", FLAG_WARN];
	if (c.stale) return ["Stale " + c.stale + "d", FLAG_WARN];
	return null;
}

const sortMark = (k: string) =>
	review.sortKey === k ? (review.sortDir === "asc" ? "▲" : "▼") : "";
const sortBtn = (k: string) =>
	"flex cursor-pointer items-center gap-[5px] border-0 bg-transparent p-0 text-left text-[12px] font-medium whitespace-nowrap " +
	(review.sortKey === k ? "text-accent" : "text-faint hover:text-muted");

function openRow(c: Candidate, i: number) {
	review.open(c, i);
	goto("/review");
}
</script>

<section class="flex min-h-0 flex-1 flex-col font-sans">
	{#if review.empty}
		<EmptyState title="Queue empty">
			<div class="text-ink-2">Nothing pending. Every queued candidate has been reviewed.</div>
			<div class="grid gap-x-3 gap-y-1 text-[12.5px] text-muted max-md:gap-y-2 md:grid-cols-[170px_1fr]">
				<span class="text-faint">Candidates reviewed</span><span class="font-mono text-[12px]">{review.total}</span>
				<span class="text-faint">Pipeline</span><span class="text-ink-2">{page.data.pipeline ? "scheduler on — sources refill the queue on their schedule" : "scheduler off — only a manual run refills the queue"}</span>
			</div>
			<div class="mt-1 flex gap-2 max-md:flex-col">
				<button class="btn-secondary" onclick={() => goto("/history")}>History</button>
			</div>
		</EmptyState>
	{:else}
		<!-- Phone: the filter trigger is in the title bar; the sheet is mounted below. -->
		<div class="hidden shrink-0 flex-wrap items-center gap-[14px] border-b border-line bg-panel px-4 py-2.5 md:flex">
			<div class="flex rounded-lg border border-line p-[2px]">
				{#each types as t (t[0])}
					<button
						class={seg(review.typeFilter === t[0])}
						onclick={() => {
							review.typeFilter = t[0];
							review.qIdx = 0;
						}}>{t[1]}</button
					>
				{/each}
			</div>
			<div class="flex rounded-lg border border-line p-[2px]">
				{#each confs as c (c[0])}
					<button
						class="{seg(review.confFilter === c[0])} {c[0] === 'all' ? '' : 'font-mono !text-[12px]'}"
						onclick={() => {
							review.confFilter = c[0];
							review.qIdx = 0;
						}}>{c[1]}</button
					>
				{/each}
			</div>
			<span class="ml-auto text-[12px] whitespace-nowrap text-faint">
				{rows.length} shown · {review.pendingCount} pending
			</span>
		</div>

		<div class="flex min-h-0 flex-1 flex-col">
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if !rows.length && review.scopeArea}
					<div class="m-rise flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-4 text-[13px] text-muted">
						<span>No candidates loaded for {review.scopeArea.name} yet.</span>
						<button class="btn-secondary" onclick={() => review.setScope(null)}>Show all areas</button
						>
					</div>
				{/if}
				<div class="md:hidden">
					{#each rows as c, i (c.id)}
						{@const f = flag(c)}
						<button
							type="button"
							class="grid w-full cursor-pointer grid-cols-[9px_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-line-row px-4 py-3 text-left {i ===
							review.qIdx
								? 'bg-sel shadow-[inset_2px_0_0_var(--accent)]'
								: 'bg-transparent'}"
							onclick={() => openRow(c, i)}
						>
							<span class="h-[9px] w-[9px] self-center rounded-full {typeDot(c.type)}"></span>
							<span class="flex min-w-0 items-baseline gap-2">
								<b class="min-w-0 truncate text-[15px] font-medium text-ink">{c.name}</b>
								<span class="shrink-0 text-[12px] {typeText(c.type)}">{typeLabel(c.type)}</span>
							</span>
							<span class="text-right font-mono text-[14px] tabular-nums {confText(c.conf)}">{pct(c.conf)}</span>
							<span class="col-start-2 truncate font-mono text-[11.5px] text-faint"
								><span class="text-link">{c.osmId ?? "new POI"}</span> · {c.source} · {c.tags.map((t) => OP_SIGN[t.op] + t.k).join(" ")}</span
							>
							<span class="text-right font-mono text-[11.5px] {c.stale ? 'text-warn' : 'text-faint'}">{c.age}</span>
							{#if f}
								<span class="col-start-2 col-end-4 mt-1"><span class="{CHIP} {f[1]}">{f[0]}</span></span>
							{/if}
						</button>
					{/each}
					<div class="px-4 py-3 text-[12px] text-faint">
						{rows.length} of {review.pendingCount} pending
					</div>
				</div>

				<div class="max-md:hidden">
					<div class="sticky top-0 z-1 border-b border-line bg-head px-4 py-2 {cols}">
						<span></span>
						<span class="flex items-center gap-4">
							{#each objectSorts as s (s[0])}
								<button title="Sort" class={sortBtn(s[0])} onclick={() => review.sortBy(s[0])}
									>{s[1]}<span class="text-[9px] leading-none">{sortMark(s[0])}</span></button
								>
							{/each}
						</span>
						<button title="Sort" class={sortBtn("flags")} onclick={() => review.sortBy("flags")}
							>Flags<span class="text-[9px] leading-none">{sortMark("flags")}</span></button
						>
						<button title="Sort" class={sortBtn("conf")} onclick={() => review.sortBy("conf")}
							>Confidence<span class="text-[9px] leading-none">{sortMark("conf")}</span></button
						>
						<button title="Sort" class="{sortBtn('age')} justify-end" onclick={() => review.sortBy("age")}
							><span class="text-[9px] leading-none">{sortMark("age")}</span>Age</button
						>
					</div>

					{#each rows as c, i (c.id)}
						{@const on = i === review.qIdx}
						{@const f = flag(c)}
						<button
							type="button"
							class="w-full cursor-pointer border-b border-line-row px-4 py-2.5 text-left {cols}
							{on ? 'bg-sel shadow-[inset_2px_0_0_var(--accent)]' : 'bg-transparent hover:bg-panel'}"
							onclick={() => openRow(c, i)}
						>
							<span class="h-[9px] w-[9px] rounded-full {typeDot(c.type)}"></span>
							<span class="flex min-w-0 flex-col gap-[2px]">
								<span class="flex min-w-0 items-baseline gap-2">
									<b class="min-w-0 truncate text-[14px] font-medium text-ink">{c.name}</b>
									<span class="shrink-0 text-[12px] {typeText(c.type)}">{typeLabel(c.type)}</span>
								</span>
								<span class="truncate font-mono text-[11.5px] text-faint"
									><span class="text-link">{c.osmId ?? "new POI"}</span> &nbsp;·&nbsp; {c.source} &nbsp;·&nbsp; {c.tags
										.map((t) => OP_SIGN[t.op] + t.k)
										.join(" ")}</span
								>
							</span>
							<span class="min-w-0">
								{#if f}<span class="{CHIP} max-w-full truncate {f[1]}">{f[0]}</span>{/if}
							</span>
							<span class="flex flex-col gap-1">
								<span class="font-mono text-[14px] tabular-nums {confText(c.conf)}">{pct(c.conf)}</span>
								<span class="block h-[3px] rounded-full bg-line">
									<span class="block h-[3px] rounded-full {confBg(c.conf)}" style="width: {Math.round(c.conf * 100)}%"></span>
								</span>
							</span>
							<span class="text-right font-mono text-[12px] {c.stale ? 'text-warn' : 'text-faint'}">{c.age}</span>
						</button>
					{/each}
				</div>
			</div>

			<footer class="hidden shrink-0 items-center gap-2 border-t border-line px-4 py-[9px] text-[12px] text-faint md:flex">
				<span>{rowsLabel}</span>
				{#if keys.showHints}
					{@const b = keys.bindings}
					<span class="ml-auto hidden items-center gap-1.5 lg:flex">
						<span class={KBD}>{keys.vim ? kbdLabel(b.down) + " " + kbdLabel(b.up) : "↓ ↑"}</span><span class="mr-3">move</span>
						<span class={KBD}>{kbdLabel(b.open)}</span><span class="mr-3">open</span>
						<span class={KBD}>{kbdLabel(b.back)}</span><span>back</span>
					</span>
				{/if}
			</footer>
		</div>

		<QueueFilterSheet bind:open={review.filterSheet} />
	{/if}
</section>
