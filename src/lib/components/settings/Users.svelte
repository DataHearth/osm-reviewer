<script lang="ts">
import { untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { zod4Client } from "sveltekit-superforms/adapters";
import { ghost, INPUT } from "$lib/format";
import { post } from "$lib/post";
import { newUserSchema, ROLES } from "$lib/schemas/settings";
import type { ManagedUser } from "$lib/types";
import type { PageData } from "../../../routes/server/$types";
import Field from "./Field.svelte";
import Pane from "./Pane.svelte";

let { data }: { data: PageData } = $props();

let added = $state(false);
const create = superForm(
	untrack(() => data.forms.newUser),
	{
		id: "new-user",
		validators: zod4Client(newUserSchema),
		onResult: ({ result }) => {
			added = result.type === "success";
		},
	},
);
const { form, errors, message, enhance } = create;
const fieldError = $derived($errors.name?.[0] ?? $errors.email?.[0] ?? $errors.password?.[0]);
const note = $derived(fieldError ?? $message ?? null);

// Delete is the one action that cannot be undone, so it takes a second click on the same row.
let confirming = $state<string | null>(null);
let failure = $state<{ id: string; text: string } | null>(null);

async function act(action: string, fields: Record<string, string | boolean>) {
	confirming = null;
	const res = await post(action, fields);
	failure = res.ok ? null : { id: String(fields.id), text: res.message };
}

const signIn = (u: ManagedUser) =>
	u.password
		? u.sso
			? "password · " + data.sso.provider
			: "password"
		: data.sso.provider + " only";
</script>

<Pane
	title="users"
	desc="Everyone who can sign in here. New SSO accounts arrive as reviewers on their first sign-in; promote them here."
>
	<div class="overflow-hidden rounded-md border border-line">
		<div class="border-b border-line-soft bg-head px-3 py-2 text-[10.5px] tracking-[0.08em] text-muted">
			ACCOUNTS · {data.users.length}
		</div>
		<ul>
			{#each data.users as u (u.id)}
				{@const self = u.id === data.user.id}
				<li class="border-b border-line-faint px-3 py-2.5 last:border-b-0">
					<div class="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-3">
						<div class="flex min-w-0 flex-1 items-center gap-2.5">
							<span
								class="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full border border-edge bg-raised text-[10.5px] tracking-[0.02em] text-muted"
								>{u.initials}</span
							>
							<div class="min-w-0">
								<div class="truncate text-[12.5px] {u.disabled ? 'text-faint line-through' : 'text-ink'}">
									{u.name}{#if self}<span class="text-faint">{" · you"}</span>{/if}
								</div>
								<div class="truncate text-[11px] text-faint">{u.email}</div>
							</div>
						</div>

						<div class="text-[11px] leading-relaxed text-faint xl:w-[250px] xl:shrink-0">
							<span class={u.role === "admin" ? "text-accent" : "text-ink-2"}>{u.role}</span> · {signIn(u)}{#if u.disabled}{" · "}<span class="text-bad-ink">disabled</span>{/if}
							<div>last seen {u.lastSeen}</div>
						</div>

						{#if !self}
							<div class="flex flex-wrap gap-1.5 xl:w-[350px] xl:shrink-0 xl:flex-nowrap xl:justify-end">
								<button
									class="{ghost(false)} max-md:min-h-[40px]"
									onclick={() => act("?/userRole", { id: u.id, role: u.role === "admin" ? "reviewer" : "admin" })}
									>{u.role === "admin" ? "make reviewer" : "make admin"}</button
								>
								<button
									class="{ghost(false)} max-md:min-h-[40px]"
									onclick={() => act("?/userDisabled", { id: u.id, disabled: !u.disabled })}
									>{u.disabled ? "enable" : "disable"}</button
								>
								{#if u.decisions === 0}
									{#if confirming === u.id}
										<button
											class="m-pop cursor-pointer rounded-sm border border-bad-line bg-bad-bg px-[11px] py-1 text-[12px] whitespace-nowrap text-bad-ink max-md:min-h-[40px]"
											onclick={() => act("?/userDelete", { id: u.id })}>confirm delete</button
										>
									{:else}
										<button class="{ghost(false)} max-md:min-h-[40px]" onclick={() => (confirming = u.id)}>delete</button>
									{/if}
								{/if}
							</div>
						{:else}
							<div class="hidden xl:block xl:w-[350px] xl:shrink-0"></div>
						{/if}
					</div>
					{#if failure?.id === u.id}
						<div class="m-rise mt-1.5 text-[11.5px] text-bad-ink">{failure.text}</div>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
	<p class="-mt-2 text-[11px] leading-relaxed text-faint">
		Accounts with decisions on record cannot be deleted — disable them instead. Disabling signs them out everywhere.
	</p>

	<form method="POST" action="?/userCreate" use:enhance class="flex flex-col gap-3 border-t border-line-faint pt-4">
		<div class="text-[12px] text-ink">add an account</div>
		<div class="grid gap-3 md:max-w-[656px] md:grid-cols-2">
			<Field label="display name">
				<input class="{INPUT} max-md:min-h-[44px]" name="name" bind:value={$form.name} />
			</Field>
			<Field label="email">
				<input class="{INPUT} max-md:min-h-[44px]" type="email" name="email" spellcheck="false" bind:value={$form.email} />
			</Field>
			<Field label="role">
				<input type="hidden" name="role" value={$form.role} />
				<div class="flex gap-1.5">
					{#each ROLES as r (r)}
						<button type="button" class="{ghost($form.role === r)} max-md:min-h-[40px]" onclick={() => ($form.role = r)}
							>{r}</button
						>
					{/each}
				</div>
			</Field>
			<Field
				label="initial password"
				hint={data.sso.enabled
					? "At least 10 characters, or empty for an account that signs in through " + data.sso.provider + " only."
					: "At least 10 characters."}
			>
				<input class="{INPUT} max-md:min-h-[44px]" type="password" name="password" autocomplete="new-password" bind:value={$form.password} />
			</Field>
		</div>
		<div class="flex items-center gap-3">
			<button type="submit" class="{ghost(false)} max-md:min-h-[44px]">add account</button>
			{#if note}
				<span
					class="m-rise min-w-0 flex-1 text-[11.5px] leading-relaxed {added && !fieldError
						? 'text-ok-ink'
						: 'text-bad-ink'}">{note}</span
				>
			{/if}
		</div>
	</form>
</Pane>
