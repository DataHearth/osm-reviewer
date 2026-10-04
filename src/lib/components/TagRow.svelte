<script lang="ts">
// One proposed tag and the evidence for it, side by side. The pairing is the
// whole screen: a tag whose quote does not contain its value cannot be
// accepted, and the layout has to make that obvious without being read.
import { confText, OP_BG, OP_CHIP, OP_LABEL, pct, TEXT_BTN } from "$lib/format";
import type { Tag } from "$lib/types";

let {
	tag,
	index,
	selected,
	value,
	onToggle,
	onEdit,
	onDelete,
}: {
	tag: Tag;
	index: number;
	selected: boolean;
	/** The value that would be written: the proposal's, or what the reviewer typed over it. */
	value: string;
	onToggle: () => void;
	onEdit: (v: string) => void;
	/** Offered on proposals that only add a key: dropping one leaves the object as it is. */
	onDelete?: () => void;
} = $props();

const edited = $derived(value !== tag.v);

const quarantined = $derived(!tag.ev);
const dimmed = $derived(!selected && !quarantined && !tag.invalid);
// The square carries the 1–9 key that toggles it, selected or not.
const num = $derived(quarantined ? "!" : String(index + 1));
const square = $derived(
	selected
		? "border-accent bg-accent text-accent-ink"
		: quarantined
			? "border-bad bg-transparent text-bad"
			: "border-edge-strong bg-transparent text-box-off",
);
</script>

<div
	class="grid overflow-hidden rounded-[10px] border {quarantined
		? 'border-bad-line'
		: 'border-line'} lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.9fr)]"
>
	<div class="flex min-w-0 flex-col gap-1.5 px-3.5 py-[11px] {quarantined ? 'bg-bad-bg' : OP_BG[tag.op]} {dimmed ? 'opacity-50' : ''}">
		<div class="flex min-w-0 items-center gap-2">
			<button
				class="shrink-0 cursor-pointer border-0 bg-transparent p-0 max-md:-m-[9px] max-md:p-[9px]"
				aria-pressed={selected}
				aria-label="{selected ? 'Deselect' : 'Select'} {tag.k}"
				onclick={onToggle}
				><span
					class="grid h-[18px] w-[18px] place-items-center rounded-[5px] border font-mono text-[10.5px] font-medium max-md:h-[26px] max-md:w-[26px] max-md:text-[12px] {square}"
					>{num}</span
				></button
			>
			<span class="shrink-0 rounded-[5px] px-1.5 font-mono text-[11px] leading-[18px] {quarantined ? 'bg-bad/15 text-bad-ink' : OP_CHIP[tag.op]}"
				>{OP_LABEL[tag.op]}</span
			>
			<span class="min-w-0 truncate font-mono text-[12.5px] text-key">{tag.k}</span>
			{#if onDelete}
				<button class="{TEXT_BTN} ml-auto" aria-label="Delete {tag.k}" onclick={onDelete}>delete</button>
			{/if}
		</div>

		{#if tag.was}
			<div class="font-mono text-[12.5px] leading-normal text-faint line-through [overflow-wrap:anywhere]">{tag.was}</div>
		{/if}

		{#if tag.op === "del"}
			<div class="font-mono text-[14px] leading-[1.45] [overflow-wrap:anywhere] {quarantined ? 'text-quarantine-ink' : 'text-ink'}">{tag.v}</div>
		{:else}
			<textarea
				rows="1"
				aria-label="Value of {tag.k}"
				class="tag-input text-[14px] leading-[1.45] {quarantined && !edited ? 'text-quarantine-ink' : 'text-ink'}"
				{value}
				oninput={(e) => onEdit(e.currentTarget.value)}
				onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
			></textarea>
			{#if edited}
				<div class="flex items-baseline gap-2 text-[11.5px]">
					<span class="text-accent">edited</span>
					<span class="min-w-0 truncate font-mono text-faint">proposed {tag.v}</span>
					<button class={TEXT_BTN} onclick={() => onEdit(tag.v)}>reset</button>
				</div>
			{/if}
		{/if}

		{#if tag.invalid}
			<div class="mt-0.5 rounded-lg border border-bad-line bg-bad-deep px-3 py-2 text-[12px] leading-[1.55]">
				<div class="text-[11.5px] font-medium text-bad-ink">Syntax error · <span class="font-mono">opening_hours</span></div>
				<div class="mt-[3px] font-mono text-[11.5px] text-ink">{tag.invalidMsg}</div>
				<div class="mt-0.5 text-ink-2">{tag.invalidHint}</div>
			</div>
		{/if}
	</div>

	<div class="min-w-0 px-3.5 py-[11px] max-lg:border-t lg:border-l {quarantined ? 'border-bad-line bg-bad-bg' : 'border-line bg-panel'}">
		<div class="mb-1 text-[11.5px] font-medium text-faint lg:hidden">Evidence</div>
		{#if tag.ev}
			<div class="text-[13px] leading-[1.55] text-ink-2">
				“{#each tag.ev.parts as p, i (i)}{#if p.mark}<span class="rounded-[3px] bg-mark-bg px-[3px] font-mono text-[12px] text-mark-ink"
							>{p.text}</span
						>{:else}<span>{p.text}</span>{/if}{/each}”
			</div>
			<div class="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[11.5px] text-faint">
				<a href={tag.ev.url} target="_blank" rel="noreferrer" class="font-mono">{tag.ev.path}</a>
				<span>{tag.ev.when}</span>
				<span class={tag.ev.kind === "verbatim" || tag.ev.kind === "dataset row" ? "text-faint" : "text-warn-ink"}>{tag.ev.kind}</span>
				<span class="font-mono {confText(tag.ev.conf)}">{pct(tag.ev.conf)}</span>
			</div>
		{:else}
			<div class="text-[13px] leading-normal text-bad-ink">No evidence — value absent from source</div>
			<div class="mt-1 text-[11.5px] text-bad">
				Quarantined · excluded from upload · conf <span class="font-mono">{pct(tag.conf)}</span>
			</div>
		{/if}
	</div>
</div>
