<script lang="ts">
import { untrack } from "svelte";
import { type SuperValidated, superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { boxBtn } from "$lib/format";
import {
	ACTION_IDS,
	ACTIONS,
	type Action,
	clashes,
	DEFAULT_BINDINGS,
	keyLabel,
	RESERVED,
	UNBINDABLE,
} from "$lib/keymap";
import { type KeysForm, keysSchema } from "$lib/schemas/settings";
import { settings } from "$lib/stores/settings.svelte";
import Field from "./Field.svelte";
import Pane from "./Pane.svelte";

let { form: initial }: { form: SuperValidated<KeysForm> } = $props();

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

let capturing = $state<Action | null>(null);
const clashing = $derived(new Set(clashes($form.bindings)));

// stopPropagation keeps the pressed key from also reaching the layout's handler,
// which would otherwise act on it — u would undo, esc would leave the page.
function capture(e: KeyboardEvent, a: Action) {
	if (capturing !== a || e.key === "Tab") return;
	e.preventDefault();
	e.stopPropagation();
	if (e.key === "Escape") capturing = null;
	else if (!UNBINDABLE.test(e.key) && !RESERVED.test(e.key)) {
		$form.bindings[a] = e.key;
		capturing = null;
	}
}

const FIXED = [
	["queue", "↓ ↑", "move selection, across pages"],
	["queue", "← →", "previous / next page"],
	["review", "← →", "previous / next candidate"],
	["review", "1 – 9", "toggle tag n"],
];

const opts: [Exclude<keyof KeysForm, "bindings">, string][] = $derived([
	[
		"vim",
		`${keyLabel($form.bindings.down)} / ${keyLabel($form.bindings.up)} and ${keyLabel($form.bindings.prev)} / ${keyLabel($form.bindings.next)} as well as the arrow keys`,
	],
	["confirmAccept", "ask before accepting — a is otherwise immediate"],
	["showHints", "show the key hints in the queue footer"],
]);
</script>

<Pane
	title="shortcuts"
	desc="The queue exists to be cleared without reaching for the mouse. Click a key, then press its replacement; esc cancels."
	sec="keys"
	formId="settings-keys"
	onRevert={() => shortcuts.reset()}
>
	<div class="overflow-hidden rounded-md border border-line">
		{#each ACTION_IDS as a (a)}
			{@const key = $form.bindings[a]}
			<div
				class="grid items-baseline gap-x-3 border-b border-line-faint px-3 py-2 last:border-b-0 max-md:grid-cols-[62px_minmax(0,1fr)] md:grid-cols-[92px_84px_minmax(0,1fr)]"
			>
				<span class="text-[11px] text-faint">{ACTIONS[a].scope}</span>
				<button
					type="button"
					class="cursor-pointer border-0 bg-transparent p-0 text-left text-[12.5px] max-md:order-3 max-md:col-span-2 max-md:min-h-[40px] {capturing === a
						? 'text-ink'
						: clashing.has(a)
							? 'text-bad'
							: 'text-accent'}"
					onclick={() => (capturing = capturing === a ? null : a)}
					onkeydown={(e) => capture(e, a)}
					onblur={() => capturing === a && (capturing = null)}
				>
					{capturing === a ? "press a key…" : keyLabel(key)}
				</button>
				<span class="text-[12px] text-ink-2 max-md:order-2">
					{ACTIONS[a].does}
					{#if clashing.has(a)}<span class="text-[11px] text-bad"> · clashes</span>{/if}
					{#if key !== DEFAULT_BINDINGS[a]}
						<button
							type="button"
							class="ml-1 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-faint hover:text-ink"
							onclick={() => ($form.bindings[a] = DEFAULT_BINDINGS[a])}>reset to {keyLabel(DEFAULT_BINDINGS[a])}</button
						>
					{/if}
				</span>
			</div>
		{/each}
		{#each FIXED as [scope, key, does] (scope + key)}
			<div
				class="grid items-baseline gap-x-3 px-3 py-2 max-md:grid-cols-[62px_minmax(0,1fr)] md:grid-cols-[92px_84px_minmax(0,1fr)]"
			>
				<span class="text-[11px] text-faint">{scope}</span>
				<span class="text-[12.5px] text-accent max-md:order-3 max-md:col-span-2">{key}</span>
				<span class="text-[12px] text-ink-2 max-md:order-2">{does} · fixed</span>
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
