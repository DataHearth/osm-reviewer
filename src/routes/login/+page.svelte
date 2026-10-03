<script lang="ts">
import { superForm } from "sveltekit-superforms";
import { dev } from "$app/environment";
import { INSTANCE } from "$lib/data";
import { INPUT } from "$lib/format";
import { LOCKOUT_MINUTES, MAX_TRIES, SESSION_DAYS } from "$lib/schemas/auth";

// Signing in is the one screen that renders without the app shell around it,
// so it carries its own header and the instance facts that tell you which
// box you reached. Nothing behind the login is named here: version, uptime
// and worker state are facts about the deployment, not about the data.
let { data } = $props();

let emailEl = $state<HTMLInputElement | null>(null);
let submitted = $state<"password" | "sso">("password");

// svelte-ignore state_referenced_locally
const { form, errors, message, enhance, submitting } = superForm(data.form, {
	resetForm: false,
	onSubmit: ({ action }) => {
		submitted = action.search === "?/sso" ? "sso" : "password";
	},
});

$effect(() => {
	emailEl?.focus();
});

const busy = $derived($submitting);
const pending = $derived($submitting ? submitted : null);
const locked = $derived($message?.locked === true);
// One error line for the whole form, whether it came back as a form message or
// as a field error, because the design only has room for one.
const error = $derived($message?.text ?? $errors.email?.[0] ?? $errors.password?.[0] ?? null);
const errorTone = $derived($message?.tone ?? "bad");

const facts = $derived([
	["host", INSTANCE.host],
	["version", INSTANCE.version + " · " + INSTANCE.sha],
	["uptime", INSTANCE.uptime],
	["pipeline worker", "running · last run " + INSTANCE.built.slice(0, 10)],
	["identity provider", data.sso.enabled ? data.sso.host : "disabled"],
]);
</script>

<section class="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
	<div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8 md:px-10 md:py-10">
		<div class="w-full max-w-[368px]">
			<div class="mb-7 flex flex-col gap-1">
				<span class="text-[15px] font-semibold tracking-[0.02em] text-accent">candidate-review</span>
				<span class="text-[11.5px] text-faint">{INSTANCE.host} · sign in to review the queue</span>
			</div>

			{#if locked}
				<div class="m-rise mb-4 rounded-md border border-bad-line bg-bad-bg px-3 py-2.5">
					<div class="text-[12.5px] text-bad-ink">sign-in locked</div>
					<p class="mt-1 text-[11.5px] leading-relaxed text-muted">
						{MAX_TRIES} failed attempts for this account. The lock clears after {LOCKOUT_MINUTES} minutes, or when the service restarts.
					</p>
					{#if dev}
						<input type="hidden" name="email" value={$form.email} form="login" />
						<button
							type="submit"
							form="login"
							formaction="?/unlock"
							formnovalidate
							class="mt-2 cursor-pointer rounded-sm border border-edge bg-raised px-2.5 py-1 text-[11.5px] text-muted hover:text-ink"
							>clear lock (dev)</button
						>
					{/if}
				</div>
			{/if}

			<form id="login" class="flex flex-col gap-3.5" method="POST" action="?/credentials" use:enhance>
				<input type="hidden" name="redirectTo" bind:value={$form.redirectTo} />

				<label class="flex flex-col gap-[5px]">
					<span class="text-[11px] tracking-[0.06em] text-faint">email</span>
					<input
						bind:this={emailEl}
						bind:value={$form.email}
						class="{INPUT} max-md:min-h-[44px] max-md:text-[14px]"
						type="email"
						name="email"
						autocomplete="username"
						spellcheck="false"
						placeholder="you@example.net"
						disabled={locked}
					/>
				</label>

				<label class="flex flex-col gap-[5px]">
					<span class="text-[11px] tracking-[0.06em] text-faint">password</span>
					<input
						bind:value={$form.password}
						class="{INPUT} max-md:min-h-[44px] max-md:text-[14px]"
						type="password"
						name="password"
						autocomplete="current-password"
						disabled={locked}
					/>
				</label>

				{#if error}
					<div
						class="m-rise text-[11.5px] leading-relaxed {errorTone === 'bad' ? 'text-bad-ink' : 'text-warn-ink'}"
					>
						{error}
					</div>
				{/if}

				<button
					type="submit"
					class="mt-0.5 rounded-md px-[15px] py-[9px] text-[13px] max-md:min-h-[48px] {busy || locked
						? 'cursor-not-allowed border border-line bg-raised text-faint'
						: 'cursor-pointer border-0 bg-accent font-semibold text-accent-ink'}"
					disabled={busy || locked}
				>
					{pending === "password" ? "checking…" : "sign in"}
				</button>
			</form>

			{#if data.sso.enabled}
				<div class="my-5 flex items-center gap-3">
					<span class="h-px flex-1 bg-line"></span>
					<span class="text-[10.5px] tracking-[0.1em] text-muted">or</span>
					<span class="h-px flex-1 bg-line"></span>
				</div>

				<button
					class="flex w-full cursor-pointer flex-col items-start gap-[3px] rounded-md border border-edge bg-raised px-3.5 py-2.5 text-left max-md:min-h-[48px] disabled:cursor-not-allowed disabled:opacity-60"
					type="submit"
					form="login"
					formaction="?/sso"
					formnovalidate
					disabled={busy || locked}
				>
					<span class="text-[12.5px] text-ink"
						>{pending === "sso" ? "waiting for " + data.sso.host + "…" : "continue with " + data.sso.provider}</span
					>
					<span class="text-[11px] text-faint">{data.sso.host}{data.sso.group ? " · group " + data.sso.group : ""}</span>
				</button>
			{/if}

			{#if data.adminEmail}
				<p class="mt-6 text-[11px] leading-relaxed text-faint">
					demo instance — seeded accounts sign in with the password <span class="text-faint">review</span>.
					<span class="text-faint">{data.adminEmail}</span> is the admin.
				</p>
			{/if}
		</div>
	</div>

	<aside class="shrink-0 border-t border-line bg-panel px-5 py-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:py-6">
		<div class="mb-3 text-[10.5px] tracking-[0.1em] text-muted lg:mb-4">THIS INSTANCE</div>
		<div class="grid gap-x-3 gap-y-1.5 text-[11.5px] max-lg:grid-cols-2 lg:grid-cols-[1fr_auto]">
			{#each facts as f (f[0])}
				<span class="text-faint">{f[0]}</span>
				<span class="truncate text-ink-2 lg:text-right">{f[1]}</span>
			{/each}
		</div>
		<p class="mt-4 text-[11px] leading-relaxed text-faint max-lg:hidden">
			Sessions last {SESSION_DAYS} days and renew as you use them. Sign out from the account
			menu to end one.
		</p>
	</aside>
</section>
