<script lang="ts">
// The metric strip both admin screens open with: whatever the numbers are,
// the tone carries whether they are fine.
import { toneText } from "$lib/format";
import type { Tone } from "$lib/types";

let { tiles }: { tiles: { label: string; value: string; sub?: string; tone?: Tone }[] } = $props();
</script>

<div class="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] border-b border-line">
	{#each tiles as m (m.label)}
		<div class="border-r border-line-soft px-4 py-[11px]">
			<div class="font-sans text-[10.5px] tracking-[0.08em] text-muted">{m.label}</div>
			<div class="mt-[3px] mb-px font-sans text-[18px] leading-[1.3] {toneText(m.tone ?? null)}">{m.value}</div>
			<div class="text-[11px] text-faint">{m.sub ?? ""}</div>
		</div>
	{/each}
</div>
