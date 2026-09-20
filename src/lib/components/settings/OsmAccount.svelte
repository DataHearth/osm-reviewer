<script lang="ts">
import { untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { ghost, INPUT } from "$lib/format";
import { osmSchema, UPLOAD_TARGETS } from "$lib/schemas/settings";
import { settings } from "$lib/stores/settings.svelte";
import type { PageData } from "../../../routes/settings/$types";
import Field from "./Field.svelte";
import Pane from "./Pane.svelte";

let { data }: { data: PageData } = $props();

const osm = superForm(
	untrack(() => data.forms.osm),
	{
		id: "osm",
		dataType: "json",
		validators: zod4Client(osmSchema),
		resetForm: false,
		onUpdated: ({ form }) => {
			if (form.valid && !form.message) settings.markSaved("osm");
		},
	},
);
const { form, errors, enhance, tainted } = osm;
$effect(() => settings.mark("osm", osm.isTainted($tainted)));

const identity = $derived(data.identity);
const connected = $derived(!!identity && !settings.disconnected);
</script>

<Pane
	title="OSM account"
	desc="The account accepted candidates are uploaded as, and the tags every changeset carries. This is separate from the account you sign in with."
	sec="osm"
	formId="settings-osm"
	onRevert={() => osm.reset()}
>
	{#if !connected}
		<div class="rounded-md border border-warn-line bg-warn-bg px-3 py-2.5">
			<div class="text-[12.5px] text-warn-ink">no OSM account connected</div>
			<p class="mt-1 text-[11.5px] leading-relaxed text-muted">
				The composer can stage writes but cannot upload them. Connecting opens openstreetmap.org and asks for write_api.
			</p>
			<button class="mt-2 {ghost(true)} max-md:min-h-[44px]" onclick={() => settings.toggleOsm()}>connect OSM account</button>
		</div>
	{:else}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-3 py-2.5">
			<div class="min-w-0 flex-1">
				<div class="text-[12.5px] text-ink">{identity?.user}</div>
				<div class="mt-0.5 text-[11.5px] text-faint">connected {identity?.connected} · {identity?.scopes}</div>
			</div>
			<button class="{ghost(false)} max-md:min-h-[44px]" onclick={() => settings.toggleOsm()}>disconnect</button>
		</div>
	{/if}

	<!-- `contents` keeps the form out of the field stack's layout: the fields stay
	     its direct items, and the save bar reaches the form by id. -->
	<form id="settings-osm" method="POST" action="?/osm" use:enhance class="contents">
		<Field label="upload target" hint="The sandbox accepts the same API and throws the data away — the right target for a dry run.">
			<div class="flex flex-wrap gap-1.5">
				{#each UPLOAD_TARGETS as t (t)}
					<button type="button" class="{ghost($form.target === t)} max-md:min-h-[40px]" onclick={() => ($form.target = t)}>{t}</button>
				{/each}
			</div>
		</Field>

		<Field label="changeset comment" hint="The default the composer opens with. Editable per upload.">
			<textarea class="{INPUT} h-[62px] resize-none leading-relaxed md:max-w-[560px]" bind:value={$form.comment}></textarea>
			{#if $errors.comment}<span class="text-[11px] text-bad">{$errors.comment[0]}</span>{/if}
		</Field>

		<Field label="source tag">
			<input class="{INPUT} md:max-w-[420px] max-md:min-h-[44px]" bind:value={$form.sourceTag} />
		</Field>

		<div class="flex flex-wrap gap-5">
			<Field label="hashtag">
				<input class="{INPUT} max-w-[168px] max-md:min-h-[44px]" bind:value={$form.hashtag} />
			</Field>
			<Field label="max objects per changeset" hint="Smaller changesets are easier for other mappers to review and revert.">
				<input
					class="{INPUT} max-w-[110px] tabular-nums max-md:min-h-[44px]"
					type="number"
					min="1"
					max="500"
					value={$form.perChangeset}
					oninput={(e) => ($form.perChangeset = parseInt(e.currentTarget.value, 10) || 1)}
				/>
				{#if $errors.perChangeset}<span class="text-[11px] text-bad">{$errors.perChangeset[0]}</span>{/if}
			</Field>
		</div>
	</form>

	<div class="grid gap-x-3 gap-y-1.5 border-t border-line-faint pt-4 text-[12px] md:grid-cols-[168px_1fr]">
		<span class="text-faint">created_by</span>
		<span class="text-ink-2">{data.createdBy}</span>
		<span class="text-faint">written tags</span>
		<span class="text-ink-2">comment, source, created_by, hashtags</span>
	</div>
</Pane>
