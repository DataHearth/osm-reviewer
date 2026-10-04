<script lang="ts">
import { pageStep } from "$lib/format";
import { review } from "$lib/stores/review.svelte";

let { class: cls = "" }: { class?: string } = $props();

const shown = $derived(review.candidates.length);
const step = (on: boolean) => `${pageStep(on)} max-md:text-[15px]`;
</script>

<span class="flex items-center gap-2 {cls}">
	<span class="tabular-nums max-md:mr-auto">
		{shown ? `Rows ${review.offset + 1}–${review.offset + shown} of ${review.matching}` : "No matching rows"}
	</span>
	<button
		type="button"
		class={step(review.pageNo > 1)}
		disabled={review.pageNo <= 1}
		aria-label="Previous page"
		onclick={() => review.turnPage(-1)}>‹</button
	>
	<button
		type="button"
		class={step(review.pageNo < review.pages)}
		disabled={review.pageNo >= review.pages}
		aria-label="Next page"
		onclick={() => review.turnPage(1)}>›</button
	>
</span>
