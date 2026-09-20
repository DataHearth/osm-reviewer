<script lang="ts">
// One proposed tag and the evidence for it, side by side. The pairing is the
// whole screen: a tag whose quote does not contain its value cannot be
// accepted, and the layout has to make that obvious without being read.
import { confText, OP_BAR, OP_BG, OP_INK, OP_SIGN } from "$lib/format";
import type { Tag } from "$lib/types";

let {
	tag,
	index,
	selected,
	onToggle,
}: { tag: Tag; index: number; selected: boolean; onToggle: () => void } = $props();

const quarantined = $derived(!tag.ev);
const dimmed = $derived(!selected && !quarantined && !tag.invalid);
const box = $derived(quarantined ? "[!]" : selected ? "[" + (index + 1) + "]" : "[ ]");
</script>

<div class="grid border-b border-line-soft lg:grid-cols-[minmax(360px,1fr)_minmax(220px,340px)]">
	<div
		class="min-w-0 border-l-[3px] px-4 py-[10px] {quarantined
			? 'border-l-quarantine bg-bad-bg'
			: `${OP_BAR[tag.op]} ${OP_BG[tag.op]}`} {dimmed ? 'opacity-45' : ''}"
	>
		{#if tag.was}
			<div class="text-[13px] leading-normal text-was max-md:break-words md:overflow-x-auto md:whitespace-nowrap">
				<span class="text-bad-ink">- </span><span class="text-key">{tag.k}=</span>{tag.was}
			</div>
		{/if}

		<div class="flex min-w-0 items-baseline gap-2 text-[13.5px] leading-normal">
			<button
				class="shrink-0 cursor-pointer border-0 bg-transparent whitespace-nowrap max-md:-my-2 max-md:-ml-2 max-md:px-2 max-md:py-2 max-md:text-[14px] md:p-0 md:text-[12.5px] {selected
					? 'text-accent'
					: 'text-box-off'}"
				aria-pressed={selected}
				aria-label="{selected ? 'Deselect' : 'Select'} {tag.k}"
				onclick={onToggle}>{box}</button
			>
			<span class="shrink-0 {quarantined ? 'text-bad' : OP_INK[tag.op]}">{OP_SIGN[tag.op]}</span>
			<span class="shrink-0 text-key">{tag.k}</span><span class="-ml-1 shrink-0 text-key">=</span>
			<span
				class="min-w-0 {quarantined ? 'text-quarantine-ink' : 'text-ink'} max-md:break-words max-md:whitespace-normal md:overflow-x-auto md:whitespace-nowrap"
				>{tag.v}</span
			>
		</div>

		{#if tag.invalid}
			<div class="mt-1.5 rounded-sm border border-[#543029] bg-bad-deep px-2.5 py-[7px] text-[11.5px] leading-[1.55]">
				<div class="text-[10.5px] tracking-[0.05em] text-bad">SYNTAX ERROR — OPENING_HOURS</div>
				<div class="mt-[3px] text-ink">{tag.invalidMsg}</div>
				<div class="mt-0.5 text-[#d9a9a0]">{tag.invalidHint}</div>
			</div>
		{/if}
	</div>

	<div class="min-w-0 px-4 py-[10px] {quarantined ? 'border-l-bad-line bg-bad-bg' : 'border-l-line-soft bg-panel'} border-l-[3px] lg:border-l">
		<div class="mb-[3px] font-sans text-[10.5px] tracking-[0.08em] text-muted lg:hidden">EVIDENCE</div>
		{#if tag.ev}
			<div class="text-[12px] leading-normal text-muted">
				“{#each tag.ev.parts as p, i (i)}{#if p.mark}<span class="rounded-[2px] bg-mark-bg px-[3px] text-mark-ink">{p.text}</span
					>{:else}<span>{p.text}</span>{/if}{/each}”
			</div>
			<div class="mt-1 flex flex-wrap gap-2 text-[11px] text-muted">
				<a href={tag.ev.url} target="_blank" rel="noreferrer">{tag.ev.path}</a>
				<span>{tag.ev.when}</span>
				<span class={tag.ev.kind === "verbatim" || tag.ev.kind === "dataset row" ? "text-muted" : "text-[#c9a35e]"}
					>{tag.ev.kind}</span
				>
				<span class={confText(tag.ev.conf)}>{tag.ev.conf.toFixed(2)}</span>
			</div>
		{:else}
			<div class="text-[12px] leading-normal text-bad">no evidence — value absent from source</div>
			<div class="mt-1 text-[11px] text-bad">quarantined · excluded from upload · conf {tag.conf.toFixed(2)}</div>
		{/if}
	</div>
</div>
