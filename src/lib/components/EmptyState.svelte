<script lang="ts">
import type { Snippet } from "svelte";

let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="m-fade flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-10 md:py-14">
	<div class="w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-panel">
		<div class="flex items-center gap-2.5 border-b border-line px-4 py-3">
			<span class="h-[9px] w-[9px] rounded-full bg-ok"></span>
			<span class="text-[14px] font-semibold text-ink">{title}</span>
		</div>
		<div class="flex flex-col gap-3 px-4 py-4 text-[13.5px] leading-relaxed">
			{@render children()}
		</div>
	</div>
</div>
