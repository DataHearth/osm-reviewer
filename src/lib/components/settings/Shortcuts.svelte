<script lang="ts">
import { untrack } from "svelte";
import { type SuperValidated, superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { boxBtn } from "$lib/format";
import { type KeysForm, keysSchema } from "$lib/schemas/settings";
import { settings } from "$lib/stores/settings.svelte";
import type { KeyRow } from "$lib/types";
import Field from "./Field.svelte";
import Pane from "./Pane.svelte";

let { form: initial, keymap }: { form: SuperValidated<KeysForm>; keymap: KeyRow[] } = $props();

const shortcuts = superForm(
	untrack(() => initial),
	{
		id: "keys",
		dataType: "json",
		validators: zod4Client(keysSchema),
		resetForm: false,
		onUpdated: ({ form }) => {
			if (form.valid && !form.message) settings.markSaved("keys");
		},
	},
);
const { form, enhance, tainted } = shortcuts;
$effect(() => settings.mark("keys", shortcuts.isTainted($tainted)));

const opts: [keyof KeysForm, string][] = [
	["vim", "j / k as well as the arrow keys"],
	["confirmAccept", "ask before accepting — a is otherwise immediate"],
	["showHints", "show the key hints in the queue footer"],
];
</script>

<Pane
	title="shortcuts"
	desc="The queue exists to be cleared without reaching for the mouse. Keys are fixed; what they do is not."
	sec="keys"
	formId="settings-keys"
	onRevert={() => shortcuts.reset()}
>
	<div class="overflow-hidden rounded-md border border-line">
		{#each keymap as k (k[0] + k[1])}
			<div
				class="grid items-baseline gap-x-3 border-b border-line-faint px-3 py-2 last:border-b-0 max-md:grid-cols-[62px_minmax(0,1fr)] md:grid-cols-[92px_84px_minmax(0,1fr)]"
			>
				<span class="text-[11px] text-faint">{k[0]}</span>
				<span class="text-[12.5px] text-accent max-md:order-3 max-md:col-span-2">{k[1]}</span>
				<span class="text-[12px] text-ink-2 max-md:order-2">{k[2]}</span>
			</div>
		{/each}
	</div>

	<!-- `contents` keeps the form out of the field stack's layout: the fields stay
	     its direct items, and the save bar reaches the form by id. -->
	<form id="settings-keys" method="POST" action="?/keys" use:enhance class="contents">
		<Field label="behaviour">
			<div class="flex flex-col gap-1.5">
				{#each opts as o (o[0])}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left max-md:min-h-[38px]"
						onclick={() => ($form[o[0]] = !$form[o[0]])}
					>
						<span class={boxBtn($form[o[0]])}>[{$form[o[0]] ? "x" : " "}]</span>
						<span class="text-[12px] text-ink-2">{o[1]}</span>
					</button>
				{/each}
			</div>
		</Field>
	</form>

	<p class="text-[11px] leading-relaxed text-faint">
		Keys do nothing while a text field has focus, so a changeset comment can contain the letter a.
	</p>
</Pane>
