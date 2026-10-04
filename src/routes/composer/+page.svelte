<script lang="ts">
import { tick, untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { goto } from "$app/navigation";
import { sourceTag } from "$lib/changeset";
import ChangeRow from "$lib/components/ChangeRow.svelte";
import { INPUT, pageStep } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

const s = $derived(data.staged);
const conflict = $derived(review.uploadConflict);

const { form, errors, enhance } = superForm(
	untrack(() => data.form),
	{
		resetForm: false,
		onResult: ({ result }) => {
			if (result.type === "success") {
				review.upload = "sent";
				review.uploadConflict = null;
				return;
			}
			if (result.type !== "failure") return;
			const c = result.data?.conflict as typeof review.uploadConflict;
			if (c) {
				review.upload = "failed";
				review.uploadConflict = c;
			}
		},
	},
);

let uploadBtn = $state<HTMLButtonElement | null>(null);
$effect(() => {
	review.submitUpload = async () => {
		await tick();
		uploadBtn?.click();
	};
	return () => {
		review.submitUpload = null;
	};
});

const errBody = $derived(
	conflict
		? `PUT /api/0.6/changeset/${conflict.changesetId}/upload\nHTTP/1.1 409 Conflict\n\nVersion mismatch: provided ${conflict.baseVersion}, server had ${conflict.headVersion} of ${conflict.osmId}`
		: "",
);
</script>

<form method="POST" action="?/upload" use:enhance class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div
		class="flex flex-col items-start justify-between gap-2 border-b-2 border-accent bg-bar px-[14px] py-3 leading-[1.45] md:flex-row md:items-baseline md:gap-4 md:px-[18px] md:py-[14px]"
	>
		<div class="flex flex-col gap-[3px]">
			<span class="font-sans text-[19px] font-semibold text-ink">Upload changeset</span>
			<span class="text-[12px] text-faint">{s.candidates} candidates · {s.writes} tag writes · {s.changesets} changeset{s.changesets === 1 ? "" : "s"}</span>
		</div>
		<span class="text-[11.5px] text-bad">writes to {data.osmHost} · not reversible from this tool</span>
	</div>

	{#if review.upload === "failed" && conflict}
		<div class="m-rise border-b border-bad-line bg-bad-bg px-[18px] py-3">
			<div class="flex items-center gap-2.5 text-[12px] text-bad">
				<span class="rounded-xs bg-bad px-1.5 py-px font-semibold tracking-[0.05em] text-bg">UPLOAD FAILED</span>
				<span class="text-ink">HTTP 409 Conflict · changeset {conflict.changesetId} closed without writing</span>
			</div>
			<div
				class="mt-2 rounded-sm border border-bad-line bg-bg px-3 py-[9px] text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted"
			>{errBody}</div>
			<div class="mt-2 text-[12px] text-warn-ink">
				{conflict.osmId} was edited while the changeset was open. Nothing was written — all {conflict.staged} candidates are still staged. Rebase
				that one candidate, then retry.
			</div>
			<div class="mt-2.5 flex flex-wrap gap-2">
				<button
					type="button"
					class="cursor-pointer rounded-sm border-0 bg-accent px-[13px] py-[5px] font-semibold text-accent-ink"
					onclick={() => review.retryUpload()}>retry upload</button
				>
				<button
					type="button"
					class="cursor-pointer rounded-sm border border-edge-strong bg-raised px-[13px] py-[5px] text-ink"
					onclick={() => {
						review.openCandidate(conflict.candidateId);
						review.upload = "idle";
						goto("/review");
					}}>open {conflict.osmId}</button
				>
				<button
					type="button"
					class="cursor-pointer rounded-sm border border-line bg-transparent px-[13px] py-[5px] text-faint hover:text-ink"
					onclick={() => (review.upload = "idle")}>dismiss</button
				>
			</div>
		</div>
	{/if}

	<div
		class="grid grid-cols-1 items-start gap-x-0 gap-y-1.5 border-b border-line px-[14px] py-3 md:grid-cols-[120px_1fr] md:gap-x-[14px] md:gap-y-[9px] md:px-[18px] md:py-[14px]"
	>
		<span class="pt-[5px] text-[11px] text-muted">comment</span>
		<div>
			<input class={INPUT} name="comment" bind:value={$form.comment} />
			{#if $errors.comment}<div class="mt-1 text-[11px] text-bad">{$errors.comment[0]}</div>{/if}
		</div>
		<span class="text-[11px] text-muted">created_by</span>
		<span class="text-[12.5px] text-faint">{data.createdBy}</span>
	</div>

	{#if s.rows.length}
		<div
			class="sticky top-0 z-1 flex flex-wrap items-center gap-x-[14px] gap-y-1 border-b border-line bg-bar px-[14px] py-2 text-[11.5px] md:px-[18px]"
		>
			<span class="text-muted md:w-[120px]">changeset {s.cs}/{s.changesets}</span>
			<span class="min-w-0 flex-1 text-faint">{s.rows.length} objects · source <span class="text-ink-2">{sourceTag(s.rows)}</span></span>
			{#if s.changesets > 1}
				<span class="flex items-center gap-2">
					{#if s.cs > 1}<a class={pageStep(true)} href="?cs={s.cs - 1}" aria-label="Previous changeset">‹</a>{:else}<span class={pageStep(false)}>‹</span>{/if}
					{#if s.cs < s.changesets}<a class={pageStep(true)} href="?cs={s.cs + 1}" aria-label="Next changeset">›</a>{:else}<span class={pageStep(false)}>›</span>{/if}
				</span>
			{/if}
		</div>
		<div class="flex-1">
			{#each s.rows as row (row.id)}
				<ChangeRow {row}>
					<button
						type="button"
						class="mt-2 shrink-0 cursor-pointer rounded-sm border border-line bg-transparent px-[9px] py-[3px] text-[11.5px] text-faint hover:text-ink"
						onclick={() => review.unstage(row.id)}>remove</button
					>
				</ChangeRow>
			{/each}
		</div>
	{:else}
		<div class="m-rise flex-1 px-[18px] py-7 text-[13px] text-muted">
			Nothing staged. Accept candidates in review and they collect here.
		</div>
	{/if}

	<div
		class="sticky bottom-0 flex flex-wrap items-center gap-2.5 border-t border-line bg-bar px-[14px] py-[13px] max-md:pb-4 md:gap-[14px] md:px-[18px]"
	>
		<button
			bind:this={uploadBtn}
			type="submit"
			disabled={s.candidates === 0 || review.upload === "sent"}
			class="rounded-md px-[17px] py-2 text-[13.5px] whitespace-nowrap max-md:min-h-[50px] max-md:w-full {s.candidates === 0 ||
			review.upload === 'sent'
				? 'cursor-not-allowed border border-line bg-raised text-faint'
				: 'cursor-pointer border-0 bg-accent font-semibold text-accent-ink'}"
		>
			{review.upload === "sent" ? "uploaded ✓" : `upload ${s.candidates} objects  ⏎`}
		</button>
		<span class="text-[12px] text-faint">
			{review.upload === "sent"
				? "uploaded — see history"
				: `${s.candidates} objects will be modified in ${s.changesets} changeset${s.changesets === 1 ? "" : "s"}`}
		</span>
		<button
			type="button"
			class="cursor-pointer rounded-sm border border-line bg-transparent px-3 py-[5px] text-[12px] whitespace-nowrap text-faint hover:text-ink max-md:min-h-[44px] md:ml-auto"
			onclick={() => goto("/review")}>back to review</button
		>
	</div>
</form>
