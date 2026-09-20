<script lang="ts">
import { review } from "$lib/stores/review.svelte";

// Phone filter/sort sheet. The queue's chip bar cost two rows of vertical
// space and the sort control lived in a table header the phone doesn't
// render, so both move in here behind one summary button.
let { open = $bindable(false) }: { open?: boolean } = $props();
let closing = $state(false);

// The sheet leaves on a timer so it cannot be left half-dismissed: the exit
// class decorates those 200ms, it does not gate them.
function close() {
	if (!open || closing) return;
	closing = true;
	setTimeout(() => {
		open = false;
		closing = false;
	}, 200);
}

const types = ["all", "new", "update", "closure"] as const;
const confs = [
	["all", "all"],
	["high", "≥.85"],
	["mid", ".60–.85"],
	["low", "<.60"],
] as const;
const sorts = [
	["conf", "confidence"],
	["age", "age"],
	["name", "object name"],
	["type", "type"],
	["source", "source"],
	["flags", "flags"],
] as const;

const row =
	"flex min-h-[46px] cursor-pointer items-center justify-center rounded-md border px-3 text-[12.5px] ";
const pick = (on: boolean) =>
	row +
	(on ? "border-edge-strong bg-line text-accent" : "border-edge-soft bg-transparent text-muted");
</script>

{#if open}
	<button
		class="fixed inset-0 z-[1200] cursor-default border-0 bg-bg/70 md:hidden {closing ? 'm-fade-out' : 'm-fade'}"
		aria-label="Close filters"
		onclick={close}
	></button>
	<div
		class="fixed inset-x-0 bottom-0 z-[1210] max-h-[82%] overflow-y-auto rounded-t-2xl border-t border-edge bg-panel pb-[calc(env(safe-area-inset-bottom)+14px)] shadow-[0_-20px_50px_rgba(0,0,0,0.6)] md:hidden {closing
			? 'm-sheet-out'
			: 'm-sheet'}"
		role="dialog"
		aria-label="Filter and sort queue"
	>
		<div class="sticky top-0 flex items-center gap-3 border-b border-line-soft bg-panel px-4 py-3">
			<span class="mx-auto h-1 w-9 rounded-full bg-edge-strong"></span>
		</div>

		<div class="flex flex-col gap-4 px-4 py-4">
			<div>
				<div class="mb-2 font-sans text-[10.5px] tracking-[0.08em] text-muted">TYPE</div>
				<div class="grid grid-cols-4 gap-1.5">
					{#each types as t (t)}
						<button
							class={pick(review.typeFilter === t)}
							onclick={() => {
								review.typeFilter = t;
								review.qIdx = 0;
							}}>{t}</button
						>
					{/each}
				</div>
			</div>

			<div>
				<div class="mb-2 font-sans text-[10.5px] tracking-[0.08em] text-muted">CONFIDENCE</div>
				<div class="grid grid-cols-4 gap-1.5">
					{#each confs as c (c[0])}
						<button
							class={pick(review.confFilter === c[0])}
							onclick={() => {
								review.confFilter = c[0];
								review.qIdx = 0;
							}}>{c[1]}</button
						>
					{/each}
				</div>
			</div>

			<div>
				<div class="mb-2 font-sans text-[10.5px] tracking-[0.08em] text-muted">SORT BY</div>
				<div class="grid grid-cols-2 gap-1.5">
					{#each sorts as s (s[0])}
						{@const on = review.sortKey === s[0]}
						<button
							class={row +
								(on ? "border-edge-strong bg-line !justify-between text-accent" : "border-edge-soft bg-transparent !justify-between text-muted")}
							onclick={() => review.sortBy(s[0])}
						>
							<span>{s[1]}</span>
							<span class="text-[10px]">{on ? (review.sortDir === "asc" ? "▲" : "▼") : ""}</span>
						</button>
					{/each}
				</div>
			</div>

			<button
				class="flex min-h-[48px] cursor-pointer items-center justify-center rounded-md border-0 bg-accent text-[13px] font-semibold text-accent-ink"
				onclick={close}>show {review.visible.length} candidates</button
			>
		</div>
	</div>
{/if}
