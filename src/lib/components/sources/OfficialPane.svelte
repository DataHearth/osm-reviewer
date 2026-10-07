<script lang="ts">
// A shipped source the instance does not have yet: its checklist, what the row will start
// with, and the areas to read it for. Nothing is fetched until it is switched on.
import { untrack } from "svelte";
import { type SuperValidated, superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { boxBtn, primaryBtn } from "$lib/format";
import { type OfficialAdd, officialAddSchema } from "$lib/schemas/source";
import { review } from "$lib/stores/review.svelte";
import type { OfficialSource } from "$lib/types";
import OfficialChecklist from "./OfficialChecklist.svelte";

let { form: initial, official }: { form: SuperValidated<OfficialAdd>; official: OfficialSource } =
	$props();

const { form, message, enhance } = superForm(
	untrack(() => initial),
	{
		dataType: "json",
		validators: zod4Client(officialAddSchema),
		resetForm: false,
		onResult: ({ result }) => {
			if (result.type !== "success") return;
			review.srcId = (result.data?.id as string) ?? review.srcId;
			review.srcDraft = null;
		},
	},
);
$form.file = untrack(() => official.file);
$form.areas = untrack(() => Object.fromEntries(review.areas.map((a, i) => [a.id, i === 0])));

const enabledAreas = $derived(review.areas.filter((a) => $form.areas[a.id]).length);
const label = "text-[11px] text-muted";
const section =
	"border-b border-line-soft px-4 py-[9px] font-sans text-[10.5px] tracking-[0.08em] text-muted";
</script>

<form method="POST" action="?/officialAdd" use:enhance>
	<div class="flex flex-wrap items-baseline justify-between gap-4 border-b border-line bg-bar px-[18px] py-3">
		<span class="shrink-0 text-[14px] font-medium whitespace-nowrap text-ink">{official.title}</span>
		<span class="text-[11.5px] text-faint">official source · nothing is fetched until you switch it on</span>
	</div>

	<div class={section}>CHECKLIST</div>
	<OfficialChecklist {official} />

	<div class="border-t border-line-soft {section}">THE SOURCE WILL BE CREATED WITH</div>
	<div class="grid grid-cols-[124px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3 text-[12.5px]">
		<span class={label}>{official.kind === "api" ? "endpoint" : "dataset"}</span>
		<span class="min-w-0 text-[12px] break-all text-ink">{official.endpoint}</span>
		<span class={label}>kind of place</span>
		<span class="min-w-0 break-words text-ink">{official.mappingTitle} <span class="text-[12px] text-faint">{official.mapping}</span></span>
		<span class={label}>matching</span>
		<span class="text-ink">{official.matching}</span>
		<span class={label}>schedule</span>
		<span class="text-ink">{official.schedule}</span>
	</div>

	<div class="border-b border-line-soft px-[18px] py-[13px]">
		<div class="mb-2 font-sans text-[10.5px] tracking-[0.08em] text-muted">AREAS TO ENABLE</div>
		{#each review.areas as a (a.id)}
			{@const on = !!$form.areas[a.id]}
			<div class="grid grid-cols-[26px_minmax(0,1fr)_150px] items-center gap-2 py-1.5 text-[12.5px]">
				<button type="button" class={boxBtn(on)} onclick={() => ($form.areas = { ...$form.areas, [a.id]: !on })}>{on ? "[x]" : "[ ]"}</button>
				<span class="truncate {on ? 'text-ink' : 'text-faint'}">{a.name}</span>
				<span class="text-[11.5px] text-faint">{a.pending} pending</span>
			</div>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-3 px-[18px] py-[13px]">
		<button type="submit" class={primaryBtn(true)}>switch on</button>
		<button
			type="button"
			class="btn-cancel"
			onclick={() => (review.srcDraft = null)}>cancel</button
		>
		<span class="text-[11.5px] {$message ? 'text-bad' : 'text-faint'}">
			{$message ?? "first run queued for " + enabledAreas + (enabledAreas === 1 ? " area" : " areas")}
		</span>
	</div>
</form>
