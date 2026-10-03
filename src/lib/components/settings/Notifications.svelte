<script lang="ts">
import { untrack } from "svelte";
import { type SuperValidated, superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { enhance as enhanceAction } from "$app/forms";
import { boxBtn, ghost, INPUT } from "$lib/format";
import { type NotifForm, notifSchema } from "$lib/schemas/settings";
import { settings } from "$lib/stores/settings.svelte";
import Field from "./Field.svelte";
import Pane from "./Pane.svelte";

let { form: initial }: { form: SuperValidated<NotifForm> } = $props();

const notifications = superForm(
	untrack(() => initial),
	{
		id: "notif",
		dataType: "json",
		validators: zod4Client(notifSchema),
		resetForm: false,
		onUpdated: ({ form }) => {
			if (form.valid && !form.message) settings.markSaved("notif");
		},
	},
);
const { form, errors, enhance, tainted } = notifications;
$effect(() => settings.mark("notif", notifications.isTainted($tainted)));

const notif = $derived($form);

type TestResult = { channel: string; ok: boolean; error?: string };
let testing = $state(false);
let results = $state<TestResult[] | null>(null);

const events = $derived([
	["queue", `the queue passes ${notif.queueOver} pending candidates`],
	["sourceFailed", "a source run fails or its key is rejected"],
	["uploadFailed", "a changeset upload fails"],
	["runFinished", "every pipeline run finishes"],
] as [keyof NotifForm["events"], string][]);

function toggleEvent(k: keyof NotifForm["events"]) {
	$form.events[k] = !$form.events[k];
}

function toggleChannel(k: "ntfy" | "webhook" | "email") {
	$form[k].on = !$form[k].on;
}
</script>

<Pane
	title="notifications"
	desc="Where the instance shouts when it needs you. Nothing is sent while every channel is off."
	sec="notif"
	formId="settings-notif"
	onRevert={() => notifications.reset()}
>
	<!-- `contents` keeps the form out of the field stack's layout: the fields stay
	     its direct items, and the save bar reaches the form by id. -->
	<form id="settings-notif" method="POST" action="?/notif" use:enhance class="contents">
		<div class="flex flex-col gap-2">
			<!-- ntfy -->
			<div class="rounded-md border border-line bg-panel">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left max-md:min-h-[46px]"
					onclick={() => toggleChannel("ntfy")}
				>
					<span class={boxBtn(notif.ntfy.on)}>[{notif.ntfy.on ? "x" : " "}]</span>
					<span class="text-[12.5px] text-ink">ntfy</span>
					<span class="ml-auto truncate text-[11.5px] text-faint">{notif.ntfy.on ? notif.ntfy.topic : "off"}</span>
				</button>
				{#if notif.ntfy.on}
					<div class="m-rise flex flex-wrap gap-4 border-t border-line-faint px-3 py-3">
						<Field label="server" cls="min-w-0 flex-[2_1_220px]">
							<input class="{INPUT} max-md:min-h-[44px]" bind:value={$form.ntfy.server} />
						</Field>
						<Field label="topic" cls="min-w-0 flex-[1_1_160px]">
							<input class="{INPUT} max-md:min-h-[44px]" bind:value={$form.ntfy.topic} />
							{#if $errors.ntfy?.topic}<span class="text-[11px] text-bad">{$errors.ntfy.topic[0]}</span>{/if}
						</Field>
					</div>
				{/if}
			</div>

			<!-- webhook -->
			<div class="rounded-md border border-line bg-panel">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left max-md:min-h-[46px]"
					onclick={() => toggleChannel("webhook")}
				>
					<span class={boxBtn(notif.webhook.on)}>[{notif.webhook.on ? "x" : " "}]</span>
					<span class="text-[12.5px] text-ink">webhook</span>
					<span class="ml-auto truncate text-[11.5px] {notif.webhook.on && !notif.webhook.url ? 'text-warn' : 'text-faint'}"
						>{notif.webhook.on ? notif.webhook.url || "no URL set" : "off"}</span
					>
				</button>
				{#if notif.webhook.on}
					<div class="m-rise flex flex-wrap gap-4 border-t border-line-faint px-3 py-3">
						<Field label="POST url" cls="min-w-0 flex-[2_1_260px]">
							<input
								class="{INPUT} max-md:min-h-[44px]"
								placeholder="https://hooks.lan/osm-review"
								spellcheck="false"
								bind:value={$form.webhook.url}
							/>
							{#if $errors.webhook?.url}<span class="text-[11px] text-bad">{$errors.webhook.url[0]}</span>{/if}
						</Field>
						<Field label="shared secret" hint="Sent as X-Signature, HMAC-SHA256 over the body." cls="min-w-0 flex-[1_1_180px]">
							<input class="{INPUT} max-md:min-h-[44px]" type="password" bind:value={$form.webhook.secret} />
						</Field>
					</div>
				{/if}
			</div>

			<!-- email -->
			<div class="rounded-md border border-line bg-panel">
				<button
					type="button"
					class="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left max-md:min-h-[46px]"
					onclick={() => toggleChannel("email")}
				>
					<span class={boxBtn(notif.email.on)}>[{notif.email.on ? "x" : " "}]</span>
					<span class="text-[12.5px] text-ink">email</span>
					<span class="ml-auto truncate text-[11.5px] text-faint">{notif.email.on ? notif.email.to : "off"}</span>
				</button>
				{#if notif.email.on}
					<div class="m-rise flex flex-wrap gap-4 border-t border-line-faint px-3 py-3">
						<Field label="to" cls="min-w-0 flex-[2_1_240px]">
							<input class="{INPUT} max-md:min-h-[44px]" type="email" spellcheck="false" bind:value={$form.email.to} />
							{#if $errors.email?.to}<span class="text-[11px] text-bad">{$errors.email.to[0]}</span>{/if}
						</Field>
						<Field label="smtp relay" cls="min-w-0 flex-[1_1_180px]">
							<input class="{INPUT} max-md:min-h-[44px]" spellcheck="false" bind:value={$form.email.relay} />
						</Field>
					</div>
				{/if}
			</div>
		</div>

		<Field label="notify me when">
			<div class="flex flex-col gap-1.5">
				{#each events as ev (ev[0])}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left max-md:min-h-[38px]"
						onclick={() => toggleEvent(ev[0])}
					>
						<span class={boxBtn(notif.events[ev[0]])}>[{notif.events[ev[0]] ? "x" : " "}]</span>
						<span class="text-[12px] text-ink-2">{ev[1]}</span>
					</button>
				{/each}
			</div>
		</Field>

		<Field label="queue threshold" hint="Pending candidates before the queue notification fires.">
			<input
				class="{INPUT} max-w-[110px] tabular-nums max-md:min-h-[44px]"
				type="number"
				min="10"
				max="2000"
				step="10"
				value={notif.queueOver}
				oninput={(e) => ($form.queueOver = parseInt(e.currentTarget.value, 10) || 10)}
			/>
			{#if $errors.queueOver}<span class="text-[11px] text-bad">{$errors.queueOver[0]}</span>{/if}
		</Field>
	</form>

	<form
		method="POST"
		action="?/notifTest"
		class="flex flex-wrap items-center gap-3 border-t border-line-faint pt-4"
		use:enhanceAction={() => {
			testing = true;
			results = null;
			return async ({ result }) => {
				testing = false;
				results =
					result.type === "success"
						? ((result.data?.test as TestResult[] | undefined) ?? [])
						: [{ channel: "request", ok: false, error: "the server refused it" }];
			};
		}}
	>
		<button class="{ghost(false)} max-md:min-h-[44px]" disabled={testing}>
			{testing ? "sending…" : "send test notification"}
		</button>
		{#if results}
			<span class="m-rise flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
				{#each results as r (r.channel)}
					<span class={r.ok ? "text-ok-ink" : "text-bad-ink"}>{r.channel} {r.ok ? "ok" : r.error}</span>
				{:else}
					<span class="text-faint">no channel is on</span>
				{/each}
			</span>
		{:else if notifications.isTainted($tainted)}
			<span class="text-[11.5px] text-faint">sends with the saved settings — save first</span>
		{/if}
	</form>
</Pane>
