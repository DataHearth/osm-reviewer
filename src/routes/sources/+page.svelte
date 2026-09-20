<script lang="ts">
import SourceDetail from "$lib/components/sources/SourceDetail.svelte";
import SourceForm from "$lib/components/sources/SourceForm.svelte";
import SourceOverview from "$lib/components/sources/SourceOverview.svelte";
import SourceRail from "$lib/components/sources/SourceRail.svelte";
import { review } from "$lib/stores/review.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// On a phone the rail and the detail pane are two screens, not two columns,
// so which one is showing is navigation state — "nothing selected" is a
// valid detail view (the aggregate), not a reason to fall back to the rail.
// Both panes are always rendered; below md the class hides one.
let pane = $state<"rail" | "detail">("rail");

const label = $derived(
	review.srcDraft
		? "new source"
		: review.srcId
			? (review.sources.find((s) => s.id === review.srcId)?.name ?? "")
			: "All sources",
);
</script>

<section
	class="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[232px_minmax(0,1fr)] md:overflow-hidden lg:grid-cols-[288px_minmax(0,1fr)]"
>
	<div
		class="min-h-0 min-w-0 flex-1 overflow-y-auto bg-panel md:border-r md:border-line {pane === 'detail' ? 'max-md:hidden' : ''}"
		onclick={(e) => {
			if ((e.target as HTMLElement).closest("button")) pane = "detail";
		}}
		role="presentation"
	>
		<SourceRail />
	</div>

	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto {pane === 'rail' ? 'max-md:hidden' : ''}">
		<div class="sticky top-0 z-2 flex items-center gap-2 border-b border-line-soft bg-panel px-2.5 md:hidden">
			<button
				class="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-[12.5px] whitespace-nowrap text-accent"
				onclick={() => (pane = "rail")}><span class="text-[15px] leading-none">‹</span> sources</button
			>
			<span class="min-w-0 flex-1 truncate text-right text-[11.5px] text-faint">{label}</span>
		</div>

		{#if review.srcDraft}
			<SourceForm form={data.form} />
		{:else if review.srcId}
			<SourceDetail />
		{:else}
			<SourceOverview />
		{/if}
	</div>
</section>
