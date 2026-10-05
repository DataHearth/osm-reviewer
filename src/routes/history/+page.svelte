<script lang="ts">
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
const rows = $derived(data.changesets);

const cols = "md:grid md:grid-cols-[130px_96px_1fr_130px_92px] md:items-baseline";
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<div class="min-h-0 flex-1 overflow-y-auto">
		<div
			class="sticky top-0 z-1 hidden border-b border-line-soft bg-head px-4 py-2 font-sans text-[10.5px] tracking-[0.08em] text-muted {cols}"
		>
			<span>CHANGESET</span><span>WHEN</span><span>COMMENT</span><span>OBJECTS</span><span>RESULT</span>
		</div>

		{#each rows as h (h.href)}
			<a
				href={h.href}
				class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line-row px-[14px] py-[11px] text-[12.5px] hover:bg-line-soft hover:no-underline md:gap-0 md:px-4 md:py-2.5 {cols}"
			>
				<span class="text-link">{h.id}</span>
				<span class="text-faint max-md:order-1">{h.when}</span>
				<span class="text-ink max-md:order-3 max-md:basis-full md:truncate md:pr-[14px]">{h.comment}</span>
				<span class="text-faint max-md:order-4">{h.objects}</span>
				<span class="{h.result === 'ok' ? 'text-ok' : 'text-bad'} max-md:order-2 max-md:ml-auto">{h.result}</span>
			</a>
		{/each}
	</div>
	<footer class="shrink-0 border-t border-line-soft px-4 py-[9px] text-[11px] text-faint">read-only · {rows.length} changesets</footer>
</section>
