<script lang="ts">
import ChangeRow from "$lib/components/ChangeRow.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
const c = $derived(data.changeset);
</script>

<section class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex flex-col gap-[3px] border-b border-line bg-bar px-[14px] py-3 leading-[1.45] md:px-[18px] md:py-[14px]">
		<a href="/history" class="text-[11.5px] text-faint">‹ history</a>
		<div class="flex flex-wrap items-baseline gap-x-3">
			<span class="font-sans text-[19px] font-semibold text-ink">Changeset {c.id}</span>
			<span class="text-[12px] {c.result === 'ok' ? 'text-ok' : 'text-bad'}">{c.result}</span>
			{#if c.url && c.result === "ok"}
				<a href={c.url} target="_blank" rel="noreferrer" class="text-[12px] md:ml-auto">open on OSM ↗</a>
			{/if}
		</div>
		<span class="text-[12px] text-faint">{c.when} · {c.objects}</span>
	</div>

	<div class="grid grid-cols-1 gap-y-1.5 border-b border-line px-[14px] py-3 md:grid-cols-[120px_1fr] md:gap-x-[14px] md:px-[18px]">
		<span class="text-[11px] text-muted">comment</span>
		<span class="text-[12.5px] text-ink">{c.comment}</span>
		{#if c.error}
			<span class="text-[11px] text-muted">error</span>
			<span class="text-[12.5px] whitespace-pre-wrap text-bad">{c.error}</span>
		{/if}
	</div>

	{#each c.rows as row (row.id)}
		<ChangeRow {row} />
	{:else}
		<div class="px-[18px] py-7 text-[13px] text-muted">
			{c.result === "ok"
				? "No objects recorded for this changeset."
				: "Nothing was written — its candidates stayed staged."}
		</div>
	{/each}
</section>
