<script lang="ts">
// What makes a shipped source official, with the community's page on it, as the file states it.
import { overrideLabel } from "$lib/format";
import type { OfficialSource } from "$lib/types";

let { official }: { official: OfficialSource } = $props();

const shown = (url: string) => url.replace(/^https:\/\//, "");
const link = "min-w-0 break-all text-accent hover:underline";
</script>

<div class="grid grid-cols-[124px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 px-4 py-3 text-[12.5px]">
	<span class="text-[11px] text-muted">published by</span>
	<span class="min-w-0 break-words text-ink">{official.publisher.name} <span class="text-faint">— {official.publisher.relation}</span></span>
	<span class="text-[11px] text-muted">licence</span>
	<span class="text-ink">{official.licence}</span>
	<span class="text-[11px] text-muted">stable address</span>
	<a class={link} href={official.address} target="_blank" rel="noreferrer">{shown(official.address)}</a>
	<span class="text-[11px] text-muted">community</span>
	<a class={link} href={official.discussion} target="_blank" rel="noreferrer">{shown(official.discussion)}</a>
	<span class="text-[11px] text-muted">overrides</span>
	<span class="min-w-0 break-words text-ink">
		{#if official.overrides.length > 0}
			{official.overrides.join(", ")}
		{:else}
			<span class="text-faint">{overrideLabel(0)}</span>
		{/if}
	</span>
</div>
