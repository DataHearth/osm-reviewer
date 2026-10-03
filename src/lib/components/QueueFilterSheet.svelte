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

const types = [
	["all", "All"],
	["new", "New"],
	["update", "Update"],
	["closure", "Closure"],
] as const;
const confs = [
	["all", "All"],
	["high", "≥ 85%"],
	["mid", "60–85%"],
	["low", "< 60%"],
] as const;
const sorts = [
	["conf", "Confidence"],
	["age", "Age"],
	["name", "Object name"],
	["type", "Type"],
	["source", "Source"],
	["flags", "Flags"],
] as const;
const label = "mb-2 text-[12.5px] font-medium text-faint";

const row =
	"flex min-h-[46px] cursor-pointer items-center justify-center rounded-lg border px-3 text-[13px] ";
const pick = (on: boolean) =>
	row +
	(on ? "border-edge-strong bg-raised text-accent" : "border-edge-soft bg-transparent text-muted");
</script>

{#if open}
	<button
		class="fixed inset-0 z-[1200] cursor-default border-0 bg-bg/70 md:hidden {closing ? 'm-fade-out' : 'm-fade'}"
		aria-label="Close filters"
		onclick={close}
	></button>
	<div
		class="fixed inset-x-0 bottom-0 z-[1210] max-h-[82%] overflow-y-auto rounded-t-2xl border-t border-edge bg-panel pb-[calc(env(safe-area-inset-bottom)+14px)] font-sans shadow-[0_-20px_50px_rgba(0,0,0,0.6)] md:hidden {closing
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
				<div class={label}>Type</div>
				<div class="grid grid-cols-4 gap-1.5">
					{#each types as t (t[0])}
						<button
							class={pick(review.typeFilter === t[0])}
							onclick={() => (review.typeFilter = t[0])}>{t[1]}</button
						>
					{/each}
				</div>
			</div>

			<div>
				<div class={label}>Confidence</div>
				<div class="grid grid-cols-4 gap-1.5">
					{#each confs as c (c[0])}
						<button
							class={pick(review.confFilter === c[0])}
							onclick={() => (review.confFilter = c[0])}>{c[1]}</button
						>
					{/each}
				</div>
			</div>

			<div>
				<div class={label}>Sort by</div>
				<div class="grid grid-cols-2 gap-1.5">
					{#each sorts as s (s[0])}
						{@const on = review.sortKey === s[0]}
						<button
							class={row +
								(on ? "border-edge-strong bg-raised !justify-between text-accent" : "border-edge-soft bg-transparent !justify-between text-muted")}
							onclick={() => review.sortBy(s[0])}
						>
							<span>{s[1]}</span>
							<span class="text-[10px]">{on ? (review.sortDir === "asc" ? "▲" : "▼") : ""}</span>
						</button>
					{/each}
				</div>
			</div>

			<button
				class="flex min-h-[48px] cursor-pointer items-center justify-center rounded-lg border-0 bg-accent text-[14px] font-semibold text-accent-ink"
				onclick={close}>Show {review.matching} candidates</button
			>
		</div>
	</div>
{/if}
