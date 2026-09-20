<script lang="ts">
import type { Snippet } from "svelte";
import { ghost, primaryBtn } from "$lib/format";
import { type Section, settings } from "$lib/stores/settings.svelte";

// Every settings pane is this shape: a titled header, a stack of fields, and
// a save bar pinned to the bottom of the scroll area. The bar belongs to the
// pane's own form without wrapping it — `formId` associates the buttons with
// a form that is nested further in, so each section saves on its own and a
// half-filled webhook can sit there while the account name is written.
let {
	title,
	desc = "",
	sec = null,
	formId = "",
	onRevert,
	children,
}: {
	title: string;
	desc?: string;
	sec?: Section | null;
	formId?: string;
	onRevert?: () => void;
	children?: Snippet;
} = $props();

const dirty = $derived(sec ? !!settings.dirty[sec] : false);
const saved = $derived(sec ? settings.saved[sec] : null);
</script>

<div class="flex min-h-full flex-col">
	<header class="border-b border-line-soft bg-panel px-4 py-3 md:px-5">
		<h2 class="text-[13px] text-ink">{title}</h2>
		{#if desc}<p class="mt-1 max-w-[560px] text-[11.5px] leading-relaxed text-faint">{desc}</p>{/if}
	</header>

	<div class="flex flex-1 flex-col gap-5 px-4 py-4 md:px-5 md:py-5">
		{@render children?.()}
	</div>

	{#if sec}
		<footer
			class="sticky bottom-0 flex items-center gap-2 border-t border-line-soft bg-panel px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] md:px-5"
		>
			<span class="min-w-0 flex-1 truncate text-[11px] {dirty ? 'text-warn-ink' : 'text-faint'}">
				{dirty ? "unsaved changes" : saved ? "saved " + saved : "no changes"}
			</span>
			{#if dirty}
				<button type="button" class="{ghost(false)} m-rise max-md:min-h-[40px]" onclick={() => onRevert?.()}>revert</button>
			{/if}
			<button type="submit" form={formId} class="{primaryBtn(dirty)} max-md:min-h-[40px]" disabled={!dirty}>save</button>
		</footer>
	{/if}
</div>
