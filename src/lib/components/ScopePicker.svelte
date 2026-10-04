<script lang="ts">
import { goto } from "$app/navigation";
import { review } from "$lib/stores/review.svelte";
import type { ScopeArea } from "$lib/types";

// The session's area scope. One list, two shapes: a popover under the scope
// button from md up, a bottom sheet on phone. Both are mounted while open and
// the breakpoint hides one, so a resize can't leave the wrong shape up.
let { open = $bindable(false) }: { open?: boolean } = $props();
let closing = $state(false);

// Long enough for the sheet's 200ms exit; the popover's 110ms one holds its end frame.
function close() {
	if (!open || closing) return;
	closing = true;
	setTimeout(() => {
		open = false;
		closing = false;
	}, 200);
}

const list = $derived(review.scopeAreas);
const total = $derived(list.reduce((n, a) => n + a.pending, 0));

const dot = (s: string) =>
	s === "active" ? "bg-ok" : s === "disabled" ? "bg-warn" : "border border-faint bg-transparent";
function meta(a: ScopeArea): [string, string | null] {
	if (a.lastRun === "never") return [a.status, null];
	const reach =
		a.def === "radius" ? `${(a.radius ?? 2500) / 1000} km radius` : `${a.sources} sources`;
	return [a.status, `ran ${a.lastRun} · ${reach}`];
}

function pick(id: string | null) {
	close();
	review.setScope(id);
}

function manage() {
	review.areaId = null;
	review.draft = null;
	open = false;
	closing = false;
	goto("/server?s=areas");
}

function onkeydown(e: KeyboardEvent) {
	if (open && e.key === "Escape") close();
}

const num = (on: boolean, n: number) =>
	`font-mono text-[12px] tabular-nums ${on ? "text-accent" : n ? "text-muted" : "text-dim"}`;
const pop = (on: boolean) =>
	"grid w-full cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 border-0 px-3.5 py-2 text-left " +
	(on ? "bg-sel shadow-[inset_2px_0_0_var(--accent)]" : "bg-transparent hover:bg-sel");
const sheetRow = (on: boolean) =>
	"flex min-h-[56px] w-full cursor-pointer items-center gap-3 border-0 px-4 text-left " +
	(on ? "bg-sel" : "bg-transparent");
</script>

<svelte:window {onkeydown} />

{#if open}
	<button
		class="fixed inset-0 z-1 cursor-default border-0 bg-bg/60 max-md:bg-bg/70 {closing ? 'm-fade-out' : 'm-fade'}"
		aria-label="Close area picker"
		onclick={close}
	></button>

	<div
		class="absolute top-full left-2.5 z-2 mt-1.5 w-[320px] origin-top-left overflow-hidden rounded-lg border border-edge-strong bg-panel text-[13px] shadow-[0_18px_44px_rgba(0,0,0,0.6)] max-md:hidden {closing
			? 'm-pop-out'
			: 'm-pop'}"
		role="dialog"
		aria-label="Area"
	>
		<button
			class="flex w-full cursor-pointer items-center justify-between border-0 border-b border-line-soft px-3.5 py-2.5 text-left {review.scope ===
			null
				? 'bg-sel text-ink shadow-[inset_2px_0_0_var(--accent)]'
				: 'bg-transparent text-ink hover:bg-sel'}"
			onclick={() => pick(null)}
		>
			All areas<span class={num(review.scope === null, total)}>{total}</span>
		</button>
		<div class="flex flex-col py-1">
			{#each list as a (a.id)}
				{@const on = review.scope === a.id}
				{@const [s, line] = meta(a)}
				<button class={pop(on)} onclick={() => pick(a.id)}>
					<span class="text-[12px] text-accent">{on ? "✓" : ""}</span>
					<span class="truncate {on ? 'font-semibold text-ink' : a.pending ? 'text-ink' : 'text-muted'}">{a.name}</span>
					<span class={num(on, a.pending)}>{a.pending}</span>
					<span></span>
					<span class="col-span-2 flex items-center gap-1.5 text-[11.5px] text-faint">
						<span class="h-1.5 w-1.5 shrink-0 rounded-full {dot(s)}"></span>
						<span class={s === "disabled" ? "text-warn-ink" : ""}>{s}</span>{#if line}<span class="truncate">· {line}</span>{/if}
					</span>
				</button>
			{/each}
		</div>
		<button
			class="flex w-full cursor-pointer items-center border-0 border-t border-line-soft bg-transparent px-3.5 py-2.5 text-left text-[12.5px] text-muted hover:text-ink"
			onclick={manage}>Manage areas ›</button
		>
	</div>

	<div
		class="fixed inset-x-0 bottom-0 z-2 max-h-[82%] overflow-y-auto rounded-t-2xl border-t border-edge bg-panel pb-[calc(env(safe-area-inset-bottom)+14px)] text-[14px] shadow-[0_-20px_50px_rgba(0,0,0,0.6)] md:hidden {closing
			? 'm-sheet-out'
			: 'm-sheet'}"
		role="dialog"
		aria-label="Area"
	>
		<div class="flex justify-center pt-2.5 pb-1"><span class="h-1 w-9 rounded-full bg-edge-strong"></span></div>
		<div class="px-4 pt-1.5 pb-2.5 text-[15px] font-semibold text-ink">Area</div>
		<button
			class="flex min-h-[48px] w-full cursor-pointer items-center justify-between border-0 border-y border-line-soft px-4 text-left text-ink {review.scope ===
			null
				? 'bg-sel'
				: 'bg-transparent'}"
			onclick={() => pick(null)}
		>
			All areas<span class={num(review.scope === null, total)}>{total}</span>
		</button>
		{#each list as a (a.id)}
			{@const on = review.scope === a.id}
			{@const [s, line] = meta(a)}
			<button class={sheetRow(on)} onclick={() => pick(a.id)}>
				<span class="w-3.5 shrink-0 text-[13px] text-accent">{on ? "✓" : ""}</span>
				<span class="flex min-w-0 flex-1 flex-col gap-0.5">
					<span class="truncate {on ? 'font-semibold text-ink' : a.pending ? 'text-ink' : 'text-muted'}">{a.name}</span>
					<span class="flex items-center gap-1.5 text-[12px] text-faint">
						<span class="h-1.5 w-1.5 shrink-0 rounded-full {dot(s)}"></span>
						<span class={s === "disabled" ? "text-warn-ink" : ""}>{s}</span>{#if line}<span class="truncate">· {line}</span>{/if}
					</span>
				</span>
				<span class={num(on, a.pending)}>{a.pending}</span>
			</button>
		{/each}
		<button
			class="flex min-h-[48px] w-full cursor-pointer items-center border-0 border-t border-line-soft bg-transparent px-4 text-left text-[13.5px] text-muted"
			onclick={manage}>Manage areas ›</button
		>
	</div>
{/if}
