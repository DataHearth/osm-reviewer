<script lang="ts">
import AreaDetail from "$lib/components/areas/AreaDetail.svelte";
import AreaForm from "$lib/components/areas/AreaForm.svelte";
import AreaOverview from "$lib/components/areas/AreaOverview.svelte";
import AreaRail from "$lib/components/areas/AreaRail.svelte";
import { review } from "$lib/stores/review.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// Same two-screen split as /sources on phone: the rail is the list screen,
// the detail pane is pushed over it. Both stay mounted; the breakpoint
// decides whether one is hidden.
let pane = $state<"rail" | "detail">("rail");

const label = $derived(
	review.draft
		? "new area"
		: review.areaId
			? (review.visibleAreas.find((a) => a.id === review.areaId)?.name ?? "")
			: "All areas",
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
		<AreaRail />
	</div>

	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto {pane === 'rail' ? 'max-md:hidden' : ''}">
		<div class="sticky top-0 z-2 flex items-center gap-2 border-b border-line-soft bg-panel px-2.5 md:hidden">
			<button
				class="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-[12.5px] whitespace-nowrap text-accent"
				onclick={() => (pane = "rail")}><span class="text-[15px] leading-none">‹</span> areas</button
			>
			<span class="min-w-0 flex-1 truncate text-right text-[11.5px] text-faint">{label}</span>
		</div>

		{#if review.draft}
			<AreaForm form={data.form} />
		{:else if review.areaId}
			<AreaDetail />
		{:else}
			<AreaOverview />
		{/if}
	</div>
</section>
