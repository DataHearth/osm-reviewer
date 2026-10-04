<script lang="ts">
import type { Snippet } from "svelte";
import { OP_INK, OP_SIGN, typeSlug } from "$lib/format";
import type { Staged } from "$lib/types";

let { row, children }: { row: Staged; children?: Snippet } = $props();
</script>

<div class="flex items-start gap-2.5 border-b border-line-soft px-[14px] md:px-[18px]">
	<details class="group min-w-0 flex-1">
		<summary class="flex min-h-[40px] cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
			<span class="shrink-0 text-[11px] text-faint group-open:rotate-90">›</span>
			<span class="shrink-0 text-[13px] text-accent">{row.osmId ?? "new POI"}</span>
			<span class="truncate font-medium text-ink">{row.name}</span>
			<span class="shrink-0 text-[11.5px] text-muted">{typeSlug(row.type)} · {row.tags.length} tags</span>
		</summary>
		<div class="flex flex-col gap-px pb-2.5 pl-[21px]">
			<div class="pb-1 text-[11.5px] text-faint">source <span class="text-ink-2">{row.source}</span></div>
			{#each row.tags as t (t.k)}
				<div class="text-[12.5px] leading-normal">
					<span class={OP_INK[t.op]}>{OP_SIGN[t.op]}</span>
					<span class="text-key">{t.k}</span><span class="text-key">=</span><span class="text-ink">{t.v}</span>
				</div>
			{/each}
		</div>
	</details>
	{@render children?.()}
</div>
