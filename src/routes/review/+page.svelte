<script lang="ts">
import { untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { goto } from "$app/navigation";
import CandidateMap from "$lib/components/CandidateMap.svelte";
import TagRow from "$lib/components/TagRow.svelte";
import { osmUrl, typeSlug } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

const c = $derived(review.candidate);
const blocked = $derived(review.blockedReason);
const selCount = $derived(review.selCount);
const selPositions = $derived(review.selected.flatMap((on, i) => (on ? [i] : [])));

// Phone splits the screen into two panes instead of one long scroll: the
// tags are the decision, everything else is context you consult. Which pane
// is showing is state, but hiding is done with breakpoint classes so md and
// up always show both regardless of it.
let pane = $state<"tags" | "context">("tags");
const failing = $derived(review.checks.filter((k) => !k.ok).length);

let acceptBtn = $state<HTMLButtonElement | null>(null);
let rejectBtn = $state<HTMLButtonElement | null>(null);

// The queue only moves on for a decision the server took, so a refusal leaves
// the candidate exactly where it was — with the reason under the tag list.
let sent = $state<string | null>(null);
const settle = (kind: "accept" | "reject") => (valid: boolean) => {
	if (sent && valid) review.settled(sent, kind);
	sent = null;
};

const accepted = superForm(
	untrack(() => data.acceptForm),
	{
		id: "accept",
		resetForm: false,
		onSubmit: () => {
			sent = c?.id ?? null;
		},
		onUpdated: ({ form }) => settle("accept")(form.valid && !form.message),
	},
);
const rejected = superForm(
	untrack(() => data.rejectForm),
	{
		id: "reject",
		resetForm: false,
		onSubmit: () => {
			sent = c?.id ?? null;
		},
		onUpdated: ({ form }) => settle("reject")(form.valid && !form.message),
	},
);

const acceptEnhance = accepted.enhance;
const rejectEnhance = rejected.enhance;
const acceptMessage = accepted.message;
const rejectMessage = rejected.message;
const refusal = $derived($acceptMessage ?? $rejectMessage ?? null);

$effect(() => {
	review.submitAccept = () => acceptBtn?.click();
	review.submitReject = () => rejectBtn?.click();
	return () => {
		review.submitAccept = null;
		review.submitReject = null;
	};
});

const action =
	"cursor-pointer rounded-sm whitespace-nowrap px-4 py-[11px] max-md:min-h-[48px] max-md:flex-1 max-md:px-2 max-md:text-[13px] md:px-3 md:py-[5px]";
const seg = (on: boolean) =>
	"flex min-h-[38px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border-0 text-[12.5px] " +
	(on ? "bg-line text-accent" : "bg-transparent text-muted");
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<!-- On tablet the screen is one scroll column; on desktop this wrapper gets
	     out of the way so the two panes scroll independently. -->
	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:contents">
		<!-- Phone is a pushed detail view: back affordance and position on one
		     line, then identity. Tablet and desktop keep the single-row header. -->
		<header class="shrink-0 border-b border-line bg-bar px-[14px] py-2 md:hidden">
			<div class="flex items-center justify-between">
				<button
					class="-ml-1 flex min-h-[34px] cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-[12.5px] text-faint"
					onclick={() => goto("/")}><span class="text-[15px] leading-none">‹</span> queue</button
				>
				<span class="text-[12px] tabular-nums text-ink">{review.position}</span>
			</div>
			<div class="flex items-baseline gap-2">
				<span class="min-w-0 shrink-0 text-[15px] font-medium text-ink">{c?.name}</span>
				<span class="min-w-0 flex-1 truncate text-[11.5px] text-faint">{c?.addr}</span>
			</div>
			<div class="mt-[3px] flex items-baseline gap-2.5 overflow-hidden text-[11.5px] whitespace-nowrap text-faint">
				<a href={osmUrl(c?.osmId ?? "")} target="_blank" rel="noreferrer" class="shrink-0 text-[11.5px]">{c?.osmId}</a>
				<span>{c ? typeSlug(c.type) : ""}</span>
				<span class="truncate">{c?.source}</span>
				<span class="ml-auto shrink-0">conf {c?.conf.toFixed(2)}</span>
			</div>
		</header>

		<header
			class="hidden shrink-0 items-center justify-between gap-6 border-b border-line bg-bar px-4 py-[11px] md:flex"
		>
			<div class="flex min-w-0 max-w-full flex-nowrap items-baseline gap-[13px] whitespace-nowrap">
				<a href={osmUrl(c?.osmId ?? "")} target="_blank" rel="noreferrer" class="text-[13.5px]">{c?.osmId}</a>
				<span class="font-medium text-ink">{c?.name}</span>
				<span class="truncate text-[12px] text-faint">{c?.addr}</span>
			</div>
			<div class="flex flex-nowrap items-center gap-4 text-[11.5px] whitespace-nowrap text-faint">
				<span>{c ? typeSlug(c.type) : ""}</span>
				<span>src={c?.source}</span>
				<span>conf {c?.conf.toFixed(2)}</span>
				<span class="text-ink">{review.position}</span>
			</div>
		</header>

		{#if c?.conflict}
			<div class="m-rise shrink-0 border-b border-bad-line bg-bad-bg">
				<div class="flex flex-wrap items-center gap-2.5 px-[14px] py-2 text-[12px] text-bad">
					<span class="rounded-xs bg-bad px-1.5 py-px font-semibold tracking-[0.05em] text-bg">CONFLICT</span>
					<span>object moved from v{c.baseVersion} to v{c.headVersion} since fetch — {c.conflictWho}</span>
				</div>
				<div class="grid gap-px border-t border-bad-line bg-bad-line md:grid-cols-2">
					<div class="bg-panel px-[14px] py-[9px]">
						<div class="mb-[5px] font-sans text-[10.5px] tracking-[0.08em] text-muted">THEIRS — v{c.headVersion} ON OSM NOW</div>
						{#each c.theirs ?? [] as t (t.k)}
							<div class="text-[12.5px] break-words text-muted"><span class="text-muted">{t.k}=</span>{t.v}</div>
						{/each}
					</div>
					<div class="bg-panel px-[14px] py-[9px]">
						<div class="mb-[5px] font-sans text-[10.5px] tracking-[0.08em] text-muted">OURS — PROPOSED FROM v{c.baseVersion}</div>
						{#each c.ours ?? [] as t (t.k)}
							<div class="text-[12.5px] break-words text-ink"><span class="text-muted">{t.k}=</span>{t.v}</div>
						{/each}
					</div>
				</div>
				<div class="flex flex-wrap gap-2 px-[14px] py-2 max-md:flex-col">
					<button
						class="cursor-pointer rounded-sm border border-edge-strong bg-raised px-[11px] py-1 text-[12px] whitespace-nowrap text-ink max-md:min-h-[44px]"
						onclick={() => review.rebase()}>rebase onto v{c.headVersion}</button
					>
					<button
						class="cursor-pointer rounded-sm border border-line bg-transparent px-[11px] py-1 text-[12px] whitespace-nowrap text-muted max-md:min-h-[44px]"
						onclick={() => review.reject()}>keep theirs, drop candidate</button
					>
					<span class="self-center text-[11px] text-bad md:ml-auto">accept is blocked until resolved</span>
				</div>
			</div>
		{/if}

		{#if c?.stale}
			<div
				class="m-rise flex shrink-0 flex-wrap items-center gap-2.5 border-b border-warn-line bg-warn-bg px-[14px] py-2 text-[12px] text-warn md:px-4"
			>
				<span class="rounded-xs bg-warn px-1.5 py-px font-semibold tracking-[0.05em] text-bg">STALE</span>
				<span class="text-warn-ink max-md:basis-full">source fetched {c.fetched}, {c.stale} days ago — queued {c.stale} days without review</span>
				<button
					class="cursor-pointer rounded-sm border border-[#55492c] bg-[#302a1e] px-2.5 py-[3px] text-[12px] text-warn md:ml-auto"
					onclick={() => (review.last = null)}>refetch source</button
				>
			</div>
		{/if}

		{#if c?.allQuarantined}
			<div
				class="m-rise flex shrink-0 flex-wrap items-center gap-2.5 border-b border-bad-line bg-bad-bg px-[14px] py-2 text-[12px] text-bad md:px-4"
			>
				<span class="rounded-xs bg-bad px-1.5 py-px font-semibold tracking-[0.05em] text-bg">QUARANTINED</span>
				<span
					>no proposed value appears in the source. Extraction is unverifiable — this candidate cannot be accepted, only rejected or
					sent back for re-extraction.</span
				>
			</div>
		{/if}

		<div class="sticky top-0 z-2 flex shrink-0 gap-1 border-b border-line-soft bg-panel px-2 py-1.5 md:hidden">
			<button class={seg(pane === "tags")} onclick={() => (pane = "tags")}>
				tags <span class="text-[11px] opacity-70">{selCount}/{c?.tags.length ?? 0}</span>
			</button>
			<button class={seg(pane === "context")} onclick={() => (pane = "context")}>
				context
				{#if failing}<span class="rounded-full bg-bad px-[5px] py-px text-[10px] text-bg">{failing}</span>{/if}
			</button>
		</div>

		<div class="flex flex-col md:shrink-0 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_312px] lg:overflow-hidden">
			<div class="min-w-0 lg:overflow-y-auto lg:border-r lg:border-line {pane === 'context' ? 'max-md:hidden' : ''}">
				{#each c?.tags ?? [] as tag, i ((c?.id ?? "") + tag.k)}
					<TagRow {tag} index={i} selected={!!review.selected[i]} onToggle={() => review.toggle(i)} />
				{/each}
				<div class="px-[14px] py-[9px] text-[12.5px] leading-relaxed text-faint">
					<span>unchanged</span> &nbsp;{c?.unchanged}
				</div>
			</div>

			<aside
				class="grid min-w-0 grid-cols-1 border-b border-line md:grid-cols-2 lg:flex lg:flex-col lg:border-b-0 lg:overflow-y-auto {pane ===
				'tags'
					? 'max-md:hidden'
					: ''}"
			>
					<CandidateMap class="h-[170px] border-b border-line bg-bar md:col-span-2 md:h-[120px] lg:col-span-1 lg:h-[180px]" />
					<div class="border-b border-line-soft px-[13px] py-[10px] text-[12px] leading-[1.65]">
						<div class="mb-0.5 font-sans text-[10.5px] tracking-[0.08em] text-muted">CHECKS</div>
						{#each review.checks as k (k.label)}
							<div class="flex items-baseline gap-2">
								<span class="shrink-0 {k.ok ? 'text-ok' : 'text-bad'}">{k.ok ? "PASS" : "FAIL"}</span>
								<span class="text-muted">{k.label}</span>
							</div>
						{/each}
					</div>
					<div class="border-b border-line-soft px-[13px] py-[10px] text-[12px] leading-[1.65] text-muted">
						<div class="mb-0.5 font-sans text-[10.5px] tracking-[0.08em] text-muted">NEARBY</div>
						{#each c?.nearby ?? [] as n (n)}
							<div>{n}</div>
						{/each}
					</div>
				<div class="px-[13px] py-[10px] text-[12px] leading-[1.65] text-muted">
					<div class="mb-0.5 font-sans text-[10.5px] tracking-[0.08em] text-muted">PROVENANCE</div>
					<div>pipeline {data.pipeline.label}</div>
					<div>extractor {data.pipeline.extractor}</div>
					<div>fetched {c?.fetched}</div>
				</div>
			</aside>
		</div>
	</div>

	{#if blocked || refusal}
		<div
			class="m-lift shrink-0 border-t border-bad-line bg-bad-deep px-[14px] py-[7px] text-[11.5px] text-bad md:px-4"
		>{blocked ?? refusal}</div>
	{/if}

	<div
		class="flex shrink-0 items-stretch gap-2 border-t border-line bg-bar px-3 py-[9px] text-[12px] text-faint max-md:pb-[calc(env(safe-area-inset-bottom)+9px)] md:flex-wrap md:items-center md:gap-[18px] md:px-4 md:py-[10px]"
	>
		<!-- Two actions, two schemas, so two forms. `contents` keeps them out of the
		     bar's flex layout: the buttons stay its direct items. -->
		<form method="POST" action="?/accept" use:acceptEnhance class="contents">
			<input type="hidden" name="id" value={c?.id ?? ""} />
			{#each selPositions as p (p)}<input type="hidden" name="tags" value={p} />{/each}
			<button
				bind:this={acceptBtn}
				type="submit"
				disabled={!!blocked}
				class="{action} {blocked
					? 'cursor-not-allowed border border-line bg-raised text-faint'
					: 'border-0 bg-accent font-semibold text-accent-ink'}"
				><span class="max-md:hidden">a &nbsp;</span>accept {selCount}<span class="max-md:hidden"
					>&nbsp;{selCount === 1 ? "tag" : "tags"}</span
				></button
			>
		</form>
		<form method="POST" action="?/reject" use:rejectEnhance class="contents">
			<input type="hidden" name="id" value={c?.id ?? ""} />
			<button bind:this={rejectBtn} type="submit" class="{action} border border-[#43312e] bg-raised text-bad"
				><span class="max-md:hidden">r &nbsp;</span>reject</button
			>
		</form>
		<button type="button" class="{action} border border-line bg-transparent text-muted" onclick={() => review.move(1)}
			><span class="max-md:hidden">x &nbsp;</span>skip</button
		>
		<span class="hidden lg:inline">
			<span class="text-[#4a4a53]">|</span>&nbsp; <b class="text-ink">1-9</b> toggle tag &nbsp; <b class="text-ink">j/k</b> next / prev
			&nbsp; <b class="text-ink">u</b> undo &nbsp; <b class="text-ink">esc</b> queue
		</span>
		<span class="ml-auto hidden text-muted lg:inline">
			{#if review.last}{review.last.kind}ed {review.last.name} · u to undo{/if}
		</span>
		<button type="button" class="hidden cursor-pointer border-0 bg-transparent text-ink lg:inline" onclick={() => goto("/composer")}
			>staged {review.stagedCount}</button
		>
	</div>
</section>
