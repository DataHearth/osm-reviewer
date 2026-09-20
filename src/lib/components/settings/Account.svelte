<script lang="ts">
import { untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { ghost, INPUT, nowStamp } from "$lib/format";
import { SESSION_DAYS } from "$lib/schemas/auth";
import { accountSchema, passwordSchema } from "$lib/schemas/settings";
import { settings } from "$lib/stores/settings.svelte";
import type { PageData } from "../../../routes/settings/$types";
import Field from "./Field.svelte";
import Pane from "./Pane.svelte";

let { data }: { data: PageData } = $props();

const account = superForm(
	untrack(() => data.forms.account),
	{
		id: "account",
		validators: zod4Client(accountSchema),
		resetForm: false,
		onUpdated: ({ form }) => {
			if (form.valid && !form.message) settings.markSaved("account");
		},
	},
);
const { form, errors, enhance, tainted } = account;
$effect(() => settings.mark("account", account.isTainted($tainted)));

const password = superForm(
	untrack(() => data.forms.password),
	{
		id: "password",
		validators: zod4Client(passwordSchema),
		invalidateAll: false,
		onUpdated: ({ form }) => {
			if (form.valid && form.message === "changed") changed = nowStamp();
		},
	},
);
const pw = password.form;
const pwErrors = password.errors;
const pwMessage = password.message;
const pwEnhance = password.enhance;

let changed = $state<string | null>(null);
const failure = $derived(
	$pwMessage === "changed"
		? null
		: ($pwMessage ?? $pwErrors.cur?.[0] ?? $pwErrors.next?.[0] ?? $pwErrors.again?.[0] ?? null),
);
</script>

<Pane
	title="account"
	desc="Your name and address on this instance. The name is what the audit trail records against each decision."
	sec="account"
	formId="settings-account"
	onRevert={() => account.reset()}
>
	<!-- `contents` keeps the form out of the field stack's layout: the fields stay
	     its direct items, and the save bar reaches the form by id. -->
	<form id="settings-account" method="POST" action="?/account" use:enhance class="contents">
		<Field label="display name">
			<input class="{INPUT} max-w-[320px] max-md:min-h-[44px]" name="name" bind:value={$form.name} />
			{#if $errors.name}<span class="text-[11px] text-bad">{$errors.name[0]}</span>{/if}
		</Field>

		<Field label="email" hint="Used to sign in and, if email notifications are on, as the reply-to address.">
			<input
				class="{INPUT} max-w-[320px] max-md:min-h-[44px]"
				type="email"
				name="email"
				spellcheck="false"
				bind:value={$form.email}
			/>
			{#if $errors.email}<span class="text-[11px] text-bad">{$errors.email[0]}</span>{/if}
		</Field>
	</form>

	<div class="grid gap-x-3 gap-y-1.5 border-t border-line-faint pt-4 text-[12px] md:grid-cols-[168px_1fr]">
		<span class="text-faint">role</span>
		<span class="text-ink"
			>{data.user.role}{data.user.role === "admin" ? " · full access, including instance settings" : " · queue, review, composer"}</span
		>
		<span class="text-faint">signed in</span>
		<span class="text-ink">{data.session.at} · via {data.session.via === "sso" ? data.sso.provider : "password"}</span>
		<span class="text-faint">session</span>
		<span class="text-ink-2">renews as you use it · expires after {SESSION_DAYS} idle days</span>
	</div>

	<div class="flex flex-col gap-3 border-t border-line-faint pt-4">
		<div class="text-[12px] text-ink">change password</div>
		{#if data.user.ssoOnly}
			<p class="text-[11.5px] leading-relaxed text-muted">
				This account has no local password — it is provisioned through {data.sso.provider}. Change it there.
			</p>
		{:else}
			<form method="POST" action="?/password" use:pwEnhance class="contents">
				<div class="flex flex-col gap-3 md:max-w-[320px]">
					<Field label="current password">
						<input class="{INPUT} max-md:min-h-[44px]" type="password" name="cur" autocomplete="current-password" bind:value={$pw.cur} />
					</Field>
					<Field label="new password" hint="At least 10 characters. Existing sessions on other devices stay signed in.">
						<input class="{INPUT} max-md:min-h-[44px]" type="password" name="next" autocomplete="new-password" bind:value={$pw.next} />
					</Field>
					<Field label="repeat new password">
						<input class="{INPUT} max-md:min-h-[44px]" type="password" name="again" autocomplete="new-password" bind:value={$pw.again} />
					</Field>
				</div>
				<div class="flex items-center gap-3">
					<button type="submit" class="{ghost(false)} max-md:min-h-[44px]">change password</button>
					{#if failure || changed}
						<span class="m-rise min-w-0 flex-1 text-[11.5px] leading-relaxed {failure ? 'text-bad-ink' : 'text-ok-ink'}"
							>{failure ?? "Password changed " + changed + ". Other sessions stay signed in."}</span
						>
					{/if}
				</div>
			</form>
		{/if}
	</div>
</Pane>
