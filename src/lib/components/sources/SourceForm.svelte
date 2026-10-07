<script lang="ts">
// New or edited source. Nothing is fetched until it is created; on an edit,
// the facts only a run can establish (volume, pagination, next run) are kept.
import { untrack } from "svelte";
import { type SuperValidated, superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { boxBtn, ghost, INPUT, INPUT_SM, primaryBtn } from "$lib/format";
import { EP_LABEL, type SourceDraft, sourceDraftSchema } from "$lib/schemas/source";
import { type DraftMark, review } from "$lib/stores/review.svelte";

let {
	form: initial,
	mappings,
}: { form: SuperValidated<SourceDraft>; mappings: { id: string; title: string }[] } = $props();

const { form, errors, enhance } = superForm(
	untrack(() => initial),
	{
		dataType: "json",
		validators: zod4Client(sourceDraftSchema),
		resetForm: false,
		onResult: ({ result }) => {
			if (result.type !== "success") return;
			review.srcId = (result.data?.id as string) ?? review.srcId;
			review.srcDraft = null;
		},
	},
);

// The rail opens the form; the values it starts from are read once per open,
// so a background reload of the sources list cannot overwrite what is typed.
let opened: DraftMark | null = null;
$effect(() => {
	const mark = review.srcDraft;
	if (!mark || mark === opened) return;
	opened = mark;
	form.set(review.sourceDraftFor(mark.editId));
});

const d = $derived($form);
const ready = $derived(sourceDraftSchema.safeParse(d).success);
const enabledAreas = $derived(review.areas.filter((a) => d.areas[a.id]).length);

/** The chip being typed is not part of the draft — only committed keys are. */
let allowInput = $state("");

const EP_HINT = {
	registry: "https://www.data.gouv.fr/api/1/datasets/…/ or a direct file URL",
	crawl: "website=* on POIs inside the area",
	api: "https://…/api/explore/v2.1/catalog/datasets/…/records",
} as const;

const KINDS: [SourceDraft["kind"], string][] = [
	["registry", "registry dump"],
	["crawl", "website crawl"],
	["api", "open-data API"],
];
const EXTRACTORS: [SourceDraft["extractor"], string][] = [
	["deterministic", "deterministic field map"],
	["model", "language model"],
];
const SCHEDULES: SourceDraft["schedule"][] = ["every 12 h", "daily", "weekly", "monthly"];

const grid =
	"grid grid-cols-1 items-start gap-y-2 border-b border-line-soft px-[14px] py-3 md:grid-cols-[124px_minmax(0,1fr)] md:items-center md:gap-x-3 md:gap-y-[11px] md:px-[18px] md:py-[14px]";

function addKey(v: string) {
	const key = v.trim().replace(/,+$/, "");
	if (!key) return;
	if (!d.allow.includes(key)) $form.allow = d.allow.concat([key]);
	allowInput = "";
}

function allowKeydown(e: KeyboardEvent) {
	const el = e.currentTarget as HTMLInputElement;
	if (e.key === "Enter" || e.key === ",") {
		e.preventDefault();
		addKey(el.value);
	} else if (e.key === "Backspace" && !el.value) {
		$form.allow = d.allow.slice(0, -1);
	}
}
</script>

<form method="POST" action="?/sourceSave" use:enhance>
	<div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-line bg-bar px-[18px] py-3">
		<span class="shrink-0 text-[14px] font-medium whitespace-nowrap text-ink">{d.editId ? "Edit source" : "New source"}</span>
		<span class="text-[11.5px] text-faint">{d.editId ? "changes apply from the next run" : "nothing is fetched until you create it"}</span>
	</div>

	<div class={grid}>
		<span class="text-[11px] text-muted">name</span>
		<div>
			<input class="{INPUT} max-w-[400px]" placeholder="e.g. data.bordeaux-metropole.fr" bind:value={$form.name} />
			{#if $errors.name}<div class="mt-1 text-[11px] text-bad">{$errors.name[0]}</div>{/if}
		</div>

		<span class="text-[11px] text-muted">kind</span>
		<div class="flex flex-wrap gap-1.5">
			{#each KINDS as k (k[0])}
				<button type="button" class={ghost(d.kind === k[0])} onclick={() => ($form.kind = k[0])}>{k[1]}</button>
			{/each}
		</div>

		<span class="text-[11px] text-muted">{EP_LABEL[d.kind]}</span>
		<div>
			<input class="{INPUT_SM} max-w-[480px]" placeholder={EP_HINT[d.kind]} bind:value={$form.endpoint} />
			{#if $errors.endpoint}<div class="mt-1 text-[11px] text-bad">{$errors.endpoint[0]}</div>{/if}
		</div>

		{#if d.kind === "api"}
			<span class="text-[11px] text-muted">api key</span>
			<input
				class="{INPUT_SM} max-w-[400px]"
				placeholder={d.editId ? "leave blank to keep the current key" : "never shown again"}
				bind:value={$form.key}
			/>
		{/if}

		{#if d.kind !== "crawl"}
			<span class="text-[11px] text-muted">matching</span>
			<input class="{INPUT_SM} max-w-[480px]" placeholder="amenity=charging_station" bind:value={$form.matching} />
		{/if}

		{#if d.kind === "crawl"}
			<span class="text-[11px] text-muted">budget</span>
			<input class="{INPUT_SM} max-w-[480px]" placeholder="400 pages / run · 1 request / 4 s per host" bind:value={$form.budget} />
		{/if}

		<span class="text-[11px] text-muted">extractor</span>
		<div class="flex flex-col gap-[5px]">
			<div class="flex flex-wrap gap-1.5">
				{#each EXTRACTORS as k (k[0])}
					<button type="button" class={ghost(d.extractor === k[0])} onclick={() => ($form.extractor = k[0])}>{k[1]}</button>
				{/each}
			</div>
			<span class="text-[11px] text-faint">
				{d.extractor === "model"
					? "every extracted tag still carries the page snippet it came from"
					: "field-to-tag map only — no model in the loop"}
			</span>
		</div>

		{#if d.extractor === "deterministic"}
			<span class="text-[11px] text-muted">kind of place</span>
			<div class="flex flex-col gap-[5px]">
				<select class="{INPUT_SM} max-w-[400px]" bind:value={$form.preset}>
					<option value={null}>detect from the columns</option>
					{#each mappings as m (m.id)}
						<option value={m.id}>{m.title} · {m.id}</option>
					{/each}
					{#if d.preset && !mappings.some((m) => m.id === d.preset)}
						<option value={d.preset}>{d.preset}</option>
					{/if}
				</select>
				{#if $errors.preset}<div class="text-[11px] text-bad">{$errors.preset[0]}</div>{/if}
			</div>
		{/if}

		<span class="text-[11px] text-muted">schedule</span>
		<div class="flex flex-wrap gap-1.5">
			{#each SCHEDULES as k (k)}
				<button type="button" class={ghost(d.schedule === k)} onclick={() => ($form.schedule = k)}>{k}</button>
			{/each}
		</div>

		<span class="text-[11px] text-muted">confidence floor</span>
		<span class="flex flex-wrap items-center gap-2.5">
			<input
				type="range"
				min="0"
				max="0.9"
				step="0.05"
				value={d.floor}
				class="w-[130px] accent-accent"
				oninput={(e) => ($form.floor = parseFloat(e.currentTarget.value))}
			/>
			<span class="text-[12.5px] text-ink">{d.floor.toFixed(2)}</span>
		</span>

		<span class="self-start pt-[3px] text-[11px] text-muted">tag allowlist</span>
		<div class="flex max-w-[480px] flex-wrap items-center gap-[5px]">
			{#each d.allow as k, i (k)}
				<span class="inline-flex items-center gap-[5px] rounded-xs border border-line bg-bar py-0.5 pr-1 pl-[7px] text-[11.5px] text-ink-2">
					{k}
					<button
						type="button"
						class="cursor-pointer border-0 bg-transparent px-0.5 text-[13px] leading-none text-faint hover:text-bad"
						onclick={() => ($form.allow = d.allow.filter((_, j) => j !== i))}>×</button
					>
				</span>
			{/each}
			<span class="inline-flex items-center gap-1">
				<input
					class="w-[132px] rounded-xs border border-edge bg-bg px-2 py-[3px] text-[11.5px] text-ink"
					placeholder="add key"
					bind:value={allowInput}
					onkeydown={allowKeydown}
				/>
				<button
					type="button"
					class="inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-xs border border-edge text-[13px] {allowInput.trim()
						? 'bg-line text-accent'
						: 'bg-transparent text-faint'}"
					onclick={() => addKey(allowInput)}>+</button
				>
			</span>
		</div>
	</div>

	<div class="border-b border-line-soft px-[18px] py-[13px]">
		<div class="mb-2 font-sans text-[10.5px] tracking-[0.08em] text-muted">AREAS TO ENABLE</div>
		{#each review.areas as a (a.id)}
			{@const on = !!d.areas[a.id]}
			<div class="grid grid-cols-[26px_minmax(0,1fr)_150px] items-center gap-2 py-1.5 text-[12.5px]">
				<button type="button" class={boxBtn(on)} onclick={() => ($form.areas = { ...d.areas, [a.id]: !on })}>{on ? "[x]" : "[ ]"}</button>
				<span class="truncate {on ? 'text-ink' : 'text-faint'}">{a.name}</span>
				<span class="text-[11.5px] text-faint">{a.pending} pending</span>
			</div>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-3 px-[18px] py-[13px]">
		<button type="submit" class={primaryBtn(ready)} disabled={!ready}>
			{d.editId ? "save changes" : "create source"}
		</button>
		<button
			type="button"
			class="btn-cancel"
			onclick={() => (review.srcDraft = null)}>cancel</button
		>
		<span class="text-[11.5px] text-faint">
			{ready
				? "first run queued for " + enabledAreas + (enabledAreas === 1 ? " area" : " areas")
				: "name and " + EP_LABEL[d.kind] + " are required"}
		</span>
	</div>
</form>
