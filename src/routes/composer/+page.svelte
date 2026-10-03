<script lang="ts">
import { tick, untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { goto } from "$app/navigation";
import { batches, sourceTag } from "$lib/changeset";
import { OP_INK, OP_SIGN, typeSlug } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

const staged = $derived(review.staged);
const writes = $derived(staged.reduce((n, x) => n + x.tags.length, 0));
const changesets = $derived(batches(staged, data.perChangeset));
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

const input = "w-full rounded-sm border border-edge bg-bg px-2.5 py-1.5 text-[13px] text-ink";
const errBody = $derived(
	conflict
		? `PUT /api/0.6/changeset/${conflict.changesetId}/upload\nHTTP/1.1 409 Conflict\n\nVersion mismatch: provided ${conflict.baseVersion}, server had ${conflict.headVersion} of ${conflict.osmId}`
		: "",
);
</script>

<section class="flex min-h-0 flex-1 items-start justify-center overflow-y-auto md:px-4 md:py-6">
	<form
		method="POST"
		action="?/upload"
		use:enhance
		class="w-full max-w-[940px] overflow-hidden max-md:border-b max-md:border-line md:rounded-xl md:border md:border-edge-strong md:bg-panel md:shadow-[0_18px_44px_rgba(0,0,0,0.42)]"
	>
		<div
			class="flex flex-col items-start justify-between gap-2 border-b-2 border-accent bg-bar px-[14px] py-3 leading-[1.45] md:flex-row md:items-baseline md:gap-4 md:px-[18px] md:py-[14px]"
		>
			<div class="flex flex-col gap-[3px]">
				<span class="font-sans text-[19px] font-semibold text-ink">Upload changeset</span>
				<span class="text-[12px] text-faint">{staged.length} candidates · {writes} tag writes · {changesets.length} changeset{changesets.length === 1 ? "" : "s"}</span>
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
				<input class={input} name="comment" bind:value={$form.comment} />
				{#if $errors.comment}<div class="mt-1 text-[11px] text-bad">{$errors.comment[0]}</div>{/if}
			</div>
			<span class="text-[11px] text-muted">created_by</span>
			<span class="text-[12.5px] text-faint">{data.createdBy}</span>
		</div>

		{#each changesets as batch, i (batch[0].id)}
			<div class="grid grid-cols-1 gap-x-[14px] gap-y-1 border-b border-line bg-bar px-[14px] py-2 text-[11.5px] md:grid-cols-[120px_1fr] md:px-[18px]">
				<span class="text-muted">changeset {i + 1}/{changesets.length}</span>
				<span class="min-w-0 text-faint">{batch.length} objects · source <span class="text-ink-2">{sourceTag(batch)}</span></span>
			</div>
			{#each batch as s (s.id)}
				<div class="flex items-start gap-2.5 border-b border-line-soft px-[14px] md:px-[18px]">
					<details class="group min-w-0 flex-1">
						<summary class="flex min-h-[40px] cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
							<span class="shrink-0 text-[11px] text-faint group-open:rotate-90">›</span>
							<span class="shrink-0 text-[13px] text-accent">{s.osmId ?? "new POI"}</span>
							<span class="truncate font-medium text-ink">{s.name}</span>
							<span class="shrink-0 text-[11.5px] text-muted">{typeSlug(s.type)} · {s.tags.length} tags</span>
						</summary>
						<div class="flex flex-col gap-px pb-2.5 pl-[21px]">
							{#each s.tags as t (t.k)}
								<div class="text-[12.5px] leading-normal">
									<span class={OP_INK[t.op]}>{OP_SIGN[t.op]}</span>
									<span class="text-key">{t.k}</span><span class="text-key">=</span><span class="text-ink">{t.v}</span>
								</div>
							{/each}
						</div>
					</details>
					<button
						type="button"
						class="mt-2 shrink-0 cursor-pointer rounded-sm border border-line bg-transparent px-[9px] py-[3px] text-[11.5px] text-faint hover:text-ink"
						onclick={() => review.unstage(s.id)}>remove</button
					>
				</div>
			{/each}
		{/each}

		{#if staged.length === 0}
			<div class="m-rise px-[18px] py-7 text-[13px] text-muted">
				Nothing staged. Accept candidates in review and they collect here.
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-2.5 border-t border-line bg-bar px-[14px] py-[13px] max-md:pb-4 md:gap-[14px] md:px-[18px]">
			<button
				bind:this={uploadBtn}
				type="submit"
				disabled={staged.length === 0 || review.upload === "sent"}
				class="rounded-md px-[17px] py-2 text-[13.5px] whitespace-nowrap max-md:min-h-[50px] max-md:w-full {staged.length === 0 ||
				review.upload === 'sent'
					? 'cursor-not-allowed border border-line bg-raised text-faint'
					: 'cursor-pointer border-0 bg-accent font-semibold text-accent-ink'}"
			>
				{review.upload === "sent" ? "uploaded ✓" : `upload ${staged.length} objects  ⏎`}
			</button>
			<span class="text-[12px] text-faint">
				{review.upload === "sent" ? "uploaded — see history" : `${staged.length} objects will be modified`}
			</span>
			<button
				type="button"
				class="cursor-pointer rounded-sm border border-line bg-transparent px-3 py-[5px] text-[12px] whitespace-nowrap text-faint hover:text-ink max-md:min-h-[44px] md:ml-auto"
				onclick={() => goto("/review")}>back to review</button
			>
		</div>
	</form>
</section>
