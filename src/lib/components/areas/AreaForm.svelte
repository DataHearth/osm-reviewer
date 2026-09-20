<script lang="ts">
// New or edited area. The map is the control: in relation mode it waits for a
// pick, in radius mode a click on it moves the centre.
import { untrack } from "svelte";
import { type SuperValidated, superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import AreaMap from "$lib/components/AreaMap.svelte";
import { boxBtn, ghost, INPUT, primaryBtn } from "$lib/format";
import { type AreaDraft, areaDraftSchema } from "$lib/schemas/area";
import { type DraftMark, review } from "$lib/stores/review.svelte";

let { form: initial }: { form: SuperValidated<AreaDraft> } = $props();

const { form, errors, enhance } = superForm(
	untrack(() => initial),
	{
		dataType: "json",
		validators: zod4Client(areaDraftSchema),
		resetForm: false,
		onResult: ({ result }) => {
			if (result.type !== "success") return;
			review.areaId = (result.data?.id as string) ?? review.areaId;
			review.draft = null;
		},
	},
);

// The rail opens the form; the values it starts from are read once per open,
// so a background reload of the areas list cannot overwrite what is typed.
let opened: DraftMark | null = null;
$effect(() => {
	const mark = review.draft;
	if (!mark || mark === opened) return;
	opened = mark;
	form.set(review.areaDraftFor(mark.editId));
});

const d = $derived($form);
const sqkm = $derived((Math.PI * d.radius * d.radius) / 1e6);
const editing = $derived(!!d.editId);
const ready = $derived(areaDraftSchema.safeParse(d).success);
const results = $derived([
	...d.extraRels,
	...review.rels.filter((r) => !d.extraRels.some((x) => x.rel === r.rel)),
]);

const MODES: [AreaDraft["mode"], string][] = [
	["relation", "OSM admin relation"],
	["radius", "radius around a point"],
];

const grid =
	"grid grid-cols-1 items-start gap-y-2 border-b border-line-soft px-[14px] py-3 md:grid-cols-[124px_minmax(0,1fr)] md:items-center md:gap-x-3 md:gap-y-[11px] md:px-[18px] md:py-[14px]";

const estimate = $derived.by(() => {
	if (!ready) return "pick a relation first";
	const radiusPois = Math.round(sqkm * 130).toLocaleString("en-US");
	if (editing)
		return (
			(d.mode === "radius" ? "≈" + radiusPois : "≈" + d.picked!.pois) +
			" POIs inside · the queue is re-scoped on the next run"
		);
	return d.mode === "radius"
		? "≈" +
				radiusPois +
				" POIs inside · first run est. " +
				Math.max(2, Math.round(sqkm / 3)) +
				" min"
		: "≈" +
				d.picked!.pois +
				" POIs inside " +
				d.picked!.name +
				" · first run est. " +
				d.picked!.est;
});
</script>

<form method="POST" action="?/save" use:enhance class="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
	<div class="flex shrink-0 flex-wrap items-baseline justify-between gap-4 border-b border-line bg-bar px-[18px] py-3">
		<span class="shrink-0 text-[14px] font-medium whitespace-nowrap text-ink">{editing ? "Edit area" : "New area"}</span>
		<span class="text-[11.5px] text-faint">
			{editing ? "changes apply from the next run" : "no candidates are fetched until you create it"}
		</span>
	</div>

	<AreaMap
		class="h-[200px] shrink-0 border-b border-line bg-bar lg:h-auto lg:min-h-[260px] lg:flex-1"
		draft={d}
		onCenter={(c) => ($form.center = c)}
	/>

	<div class="min-h-[120px] shrink overflow-y-auto">
		<div class={grid}>
			<span class="text-[11px] text-muted">name</span>
			<div>
				<input class="{INPUT} max-w-[360px]" bind:value={$form.name} />
				{#if $errors.name}<div class="mt-1 text-[11px] text-bad">{$errors.name[0]}</div>{/if}
			</div>

			<span class="text-[11px] text-muted">boundary</span>
			<div class="flex gap-1.5">
				{#each MODES as m (m[0])}
					<button type="button" class={ghost(d.mode === m[0])} onclick={() => ($form.mode = m[0])}>{m[1]}</button>
				{/each}
			</div>

			{#if d.mode === "relation"}
				<span class="text-[11px] text-muted">osm relation</span>
				<div>
					<input class="{INPUT} max-w-[360px]" bind:value={$form.query} />
					<div class="mt-[7px] max-w-[460px] overflow-hidden rounded-sm border border-line">
						{#each results as r (r.rel)}
							{@const on = d.picked?.rel === r.rel}
							<button
								type="button"
								class="flex w-full cursor-pointer items-baseline gap-2.5 border-b border-line-soft px-[11px] py-[7px] text-left {on
									? 'bg-sel shadow-[inset_2px_0_0_var(--accent)]'
									: 'bg-panel hover:bg-sel'}"
								onclick={() => {
									if (!d.name || d.name === d.picked?.name) $form.name = r.name;
									$form.picked = r;
								}}
							>
								<span class="text-ink">{r.name}</span>
								<span class="text-[11.5px] text-faint">{r.meta}</span>
							</button>
						{/each}
					</div>
					{#if $errors.picked?._errors}<div class="mt-1 text-[11px] text-bad">{$errors.picked._errors[0]}</div>{/if}
				</div>
			{:else}
				<span class="text-[11px] text-muted">centre</span>
				<span class="flex flex-wrap items-center gap-2.5 text-[12.5px] text-ink">
					{d.center[0].toFixed(4)}, {d.center[1].toFixed(4)}
					<span class="text-[11px] text-faint">click the map to move it</span>
				</span>

				<span class="text-[11px] text-muted">radius</span>
				<span class="flex flex-wrap items-center gap-3">
					<input
						type="range"
						min="250"
						max="8000"
						step="250"
						value={d.radius}
						class="w-[220px] accent-accent"
						oninput={(e) => ($form.radius = parseInt(e.currentTarget.value, 10))}
					/>
					<span class="text-[12.5px] text-ink">{(d.radius / 1000).toFixed(2)} km</span>
					<span class="text-[11px] text-faint">{sqkm.toFixed(0)} km²</span>
				</span>
			{/if}
		</div>

		<div class="border-b border-line-soft px-[18px] py-[13px]">
			<div class="mb-2 font-sans text-[10.5px] tracking-[0.08em] text-muted">SOURCES TO ENABLE</div>
			{#each review.sources as s (s.id)}
				{@const on = !!d.srcs[s.id]}
				<div class="grid grid-cols-[26px_minmax(0,1fr)_150px] items-center gap-2 py-1.5 text-[12.5px]">
					<button type="button" class={boxBtn(on)} onclick={() => ($form.srcs = { ...d.srcs, [s.id]: !on })}>{on ? "[x]" : "[ ]"}</button>
					<span class="truncate {on ? 'text-ink' : 'text-faint'}">{s.name}</span>
					<span class="text-[11.5px] text-faint">{s.kindLabel}</span>
				</div>
			{/each}
		</div>
	</div>

	<div class="flex shrink-0 flex-wrap items-center gap-3 px-[18px] py-[13px]">
		<button type="submit" class={primaryBtn(ready)} disabled={!ready}>
			{editing ? "save changes" : "create area"}
		</button>
		<button
			type="button"
			class="cursor-pointer rounded-md border border-line bg-transparent px-[14px] py-[7px] text-[13px] text-faint hover:text-ink"
			onclick={() => (review.draft = null)}>cancel</button
		>
		<span class="text-[11.5px] text-faint">{estimate}</span>
	</div>
</form>
