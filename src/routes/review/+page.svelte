<script lang="ts">
import { untrack } from "svelte";
import { superForm } from "sveltekit-superforms";
import { goto } from "$app/navigation";
import CandidateMap from "$lib/components/CandidateMap.svelte";
import TagRow from "$lib/components/TagRow.svelte";
import {
	CHIP,
	confText,
	KBD,
	KBD_ACCENT,
	osmUrl,
	pct,
	typeDot,
	typeLabel,
	typeText,
} from "$lib/format";
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
let mapOpen = $state(false);
// The map grows below the identity rather than beside it, so the header stacks
// while it is open. Expanding stacks at once; collapsing stays stacked until the
// 200ms m-grow shrink is over, or the map would jump back beside the name full size.
let stacked = $state(false);
let unstack: ReturnType<typeof setTimeout> | undefined;
function toggleMap() {
	clearTimeout(unstack);
	mapOpen = !mapOpen;
	if (mapOpen) stacked = true;
	else unstack = setTimeout(() => (stacked = false), 200);
}
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
	"inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg whitespace-nowrap px-4 py-[11px] text-[13px] max-md:min-h-[48px] max-md:flex-1 max-md:px-2 md:px-3.5 md:py-[7px]";
const seg = (on: boolean) =>
	"flex min-h-[38px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 text-[13px] font-medium " +
	(on ? "bg-raised text-ink" : "bg-transparent text-muted");
const label = "mb-1.5 text-[12px] font-medium text-faint";
const banner = CHIP + " border-transparent font-semibold text-bg";
</script>

<section class="flex min-h-0 flex-1 flex-col font-sans">
	<!-- On tablet the screen is one scroll column; on desktop this wrapper gets
	     out of the way so the two panes scroll independently. -->
	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:contents">
		<!-- Phone is a pushed detail view: back affordance and position on one
		     line, then identity. The map lives in the context pane there. -->
		<header class="shrink-0 border-b border-line bg-bar px-4 pt-2 pb-3 md:hidden">
			<div class="flex items-center justify-between">
				<button
					class="-ml-1 flex min-h-[34px] cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-[13px] text-faint"
					onclick={() => goto("/")}><span class="text-[16px] leading-none">‹</span> Queue</button
				>
				<span class="font-mono text-[12px] tabular-nums text-ink-2">{review.position}</span>
			</div>
			<div class="mt-0.5 text-[17px] leading-snug font-semibold text-ink">{c?.name}</div>
			<div class="truncate text-[13px] text-muted">{c?.addr}</div>
			{#if c}
				<div class="mt-2 flex items-center gap-2.5 overflow-hidden text-[12px] whitespace-nowrap text-faint">
					<span class="flex shrink-0 items-center gap-1.5 {typeText(c.type)}"
						><span class="h-[7px] w-[7px] rounded-full {typeDot(c.type)}"></span>{typeLabel(c.type)}</span
					>
					<a href={osmUrl(c.osmId)} target="_blank" rel="noreferrer" class="min-w-0 truncate font-mono text-[11.5px]">{c.osmId}</a>
					<span class="ml-auto shrink-0">conf <span class="font-mono {confText(c.conf)}">{pct(c.conf)}</span></span>
				</div>
			{/if}
		</header>

		<!-- Tablet and desktop: the map sits beside the identity, so the place is
		     read before any tag is. -->
		<header class="hidden shrink-0 gap-4 border-b border-line bg-bar px-4 py-3.5 md:flex {stacked ? 'flex-col-reverse' : ''}">
			<div
				class="m-grow relative shrink-0 overflow-hidden rounded-lg border border-line {mapOpen
					? 'h-[280px] w-full lg:h-[340px]'
					: 'h-[84px] w-[132px] lg:h-[96px] lg:w-[160px]'}"
			>
				<CandidateMap class="h-full w-full !bg-panel" />
				<button
					class="absolute top-1.5 right-1.5 z-[1000] flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-line bg-bar/90 text-[13px] leading-none text-muted hover:text-ink"
					aria-label={mapOpen ? "Collapse map" : "Expand map"}
					title={mapOpen ? "Collapse map" : "Expand map"}
					onclick={toggleMap}>{mapOpen ? "⤡" : "⤢"}</button
				>
			</div>
			<div class="flex min-w-0 flex-1 flex-col gap-[3px]">
				<div class="flex items-baseline justify-between gap-3">
					<span class="min-w-0 truncate text-[18px] font-semibold text-ink">{c?.name}</span>
					<span class="shrink-0 font-mono text-[12px] tabular-nums text-ink-2">{review.position}</span>
				</div>
				<span class="truncate text-[13px] text-muted">{c?.addr}</span>
				{#if c}
					<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
						<a href={osmUrl(c.osmId)} target="_blank" rel="noreferrer" class="font-mono">{c.osmId}</a>
						<span class="flex items-center gap-1.5 {typeText(c.type)}"
							><span class="h-[7px] w-[7px] rounded-full {typeDot(c.type)}"></span>{typeLabel(c.type)}</span
						>
						<span class="font-mono">{c.source}</span>
						<span>conf <span class="font-mono {confText(c.conf)}">{pct(c.conf)}</span></span>
					</div>
				{/if}
			</div>
		</header>

		{#if c?.conflict}
			<div class="m-rise shrink-0 border-b border-bad-line bg-bad-bg">
				<div class="flex flex-wrap items-center gap-2.5 px-4 py-2.5 text-[13px] text-bad-ink">
					<span class="{banner} bg-bad">Conflict</span>
					<span>Object moved from v{c.baseVersion} to v{c.headVersion} since fetch — {c.conflictWho}</span>
				</div>
				<div class="grid gap-px border-t border-bad-line bg-bad-line md:grid-cols-2">
					<div class="bg-panel px-4 py-2.5">
						<div class={label}>Theirs — v{c.headVersion} on OSM now</div>
						{#each c.theirs ?? [] as t (t.k)}
							<div class="font-mono text-[12.5px] [overflow-wrap:anywhere] text-muted"><span class="text-key">{t.k}=</span>{t.v}</div>
						{/each}
					</div>
					<div class="bg-panel px-4 py-2.5">
						<div class={label}>Ours — proposed from v{c.baseVersion}</div>
						{#each c.ours ?? [] as t (t.k)}
							<div class="font-mono text-[12.5px] [overflow-wrap:anywhere] text-ink"><span class="text-key">{t.k}=</span>{t.v}</div>
						{/each}
					</div>
				</div>
				<div class="flex flex-wrap gap-2 px-4 py-2.5 max-md:flex-col">
					<button
						class="cursor-pointer rounded-lg border border-edge-strong bg-raised px-3 py-1.5 text-[13px] font-medium whitespace-nowrap text-ink max-md:min-h-[44px]"
						onclick={() => review.rebase()}>Rebase onto v{c.headVersion}</button
					>
					<button
						class="cursor-pointer rounded-lg border border-line bg-transparent px-3 py-1.5 text-[13px] whitespace-nowrap text-muted max-md:min-h-[44px]"
						onclick={() => review.reject()}>Keep theirs, drop candidate</button
					>
					<span class="self-center text-[12px] text-bad md:ml-auto">Accept is blocked until resolved</span>
				</div>
			</div>
		{/if}

		{#if c?.stale}
			<div class="m-rise flex shrink-0 flex-wrap items-center gap-2.5 border-b border-warn-line bg-warn-bg px-4 py-2.5 text-[13px]">
				<span class="{banner} bg-warn">Stale</span>
				<span class="text-warn-ink max-md:basis-full"
					>Source fetched <span class="font-mono text-[12px]">{c.fetched}</span>, {c.stale} days ago — queued {c.stale} days without review</span
				>
				<button
					class="cursor-pointer rounded-lg border border-warn-line bg-transparent px-3 py-1 text-[12.5px] font-medium text-warn md:ml-auto"
					onclick={() => (review.last = null)}>Refetch source</button
				>
			</div>
		{/if}

		{#if c?.allQuarantined}
			<div class="m-rise flex shrink-0 flex-wrap items-center gap-2.5 border-b border-bad-line bg-bad-bg px-4 py-2.5 text-[13px] text-bad-ink">
				<span class="{banner} bg-bad">Quarantined</span>
				<span
					>No proposed value appears in the source. Extraction is unverifiable — this candidate cannot be accepted, only rejected or
					sent back for re-extraction.</span
				>
			</div>
		{/if}

		<div class="sticky top-0 z-2 flex shrink-0 gap-1 border-b border-line bg-panel px-2 py-1.5 md:hidden">
			<button class={seg(pane === "tags")} onclick={() => (pane = "tags")}>
				Tags <span class="font-mono text-[11px] font-normal text-faint">{selCount}/{c?.tags.length ?? 0}</span>
			</button>
			<button class={seg(pane === "context")} onclick={() => (pane = "context")}>
				Context
				{#if failing}<span class="rounded-full bg-bad px-[6px] py-px text-[10.5px] text-bg">{failing}</span>{/if}
			</button>
		</div>

		<div class="flex flex-col md:shrink-0 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_312px] lg:overflow-hidden">
			<div
				class="flex min-w-0 flex-col gap-2 p-2 md:p-3 lg:overflow-y-auto lg:border-r lg:border-line {pane === 'context'
					? 'max-md:hidden'
					: ''}"
			>
				{#each c?.tags ?? [] as tag, i ((c?.id ?? "") + tag.k)}
					<TagRow {tag} index={i} selected={!!review.selected[i]} onToggle={() => review.toggle(i)} />
				{/each}
				<div class="px-2 py-2 text-[12px] leading-relaxed text-faint">
					<span class="mr-2 font-medium">Unchanged</span><span class="font-mono">{c?.unchanged}</span>
				</div>
			</div>

			<aside
				class="grid min-w-0 grid-cols-1 border-b border-line md:grid-cols-2 lg:flex lg:flex-col lg:border-b-0 lg:overflow-y-auto {pane ===
				'tags'
					? 'max-md:hidden'
					: ''}"
			>
				<CandidateMap class="h-[170px] border-b border-line !bg-bar md:hidden" />
				<div class="border-b border-line-soft px-4 py-3 text-[12.5px] leading-[1.65]">
					<div class={label}>Checks</div>
					<div class="flex flex-col gap-1">
						{#each review.checks as k (k.label)}
							<div class="flex items-baseline gap-2">
								<span
									class="shrink-0 rounded-[5px] px-1.5 font-mono text-[10.5px] leading-[17px] {k.ok
										? 'bg-ok/15 text-ok-ink'
										: 'bg-bad/15 text-bad-ink'}">{k.ok ? "pass" : "fail"}</span
								>
								<span class="text-muted">{k.label}</span>
							</div>
						{/each}
					</div>
				</div>
				<div class="border-b border-line-soft px-4 py-3 text-[12.5px] leading-[1.65] text-muted">
					<div class={label}>Nearby</div>
					{#each c?.nearby ?? [] as n (n)}
						<div>{n}</div>
					{/each}
				</div>
				<div class="px-4 py-3 text-[12.5px] leading-[1.65] text-muted md:col-span-2 lg:col-span-1">
					<div class={label}>Provenance</div>
					<div class="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2">
						<span class="text-faint">Pipeline</span><span class="text-faint">not implemented</span>
						<span class="text-faint">Fetched</span><span class="font-mono text-[12px]">{c?.fetched}</span>
					</div>
				</div>
			</aside>
		</div>
	</div>

	{#if blocked || refusal}
		<div class="m-lift shrink-0 border-t border-bad-line bg-bad-deep px-4 py-2 text-[12.5px] text-bad-ink">{blocked ?? refusal}</div>
	{/if}

	<div
		class="flex shrink-0 items-stretch gap-2 border-t border-line bg-bar px-3 py-[9px] text-[12px] text-faint max-md:pb-[calc(env(safe-area-inset-bottom)+9px)] md:flex-wrap md:items-center md:px-4 md:py-[10px]"
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
				><span>Accept {selCount}<span class="max-md:hidden">&nbsp;{selCount === 1 ? "tag" : "tags"}</span></span><span
					class="max-md:hidden {KBD_ACCENT}">A</span
				></button
			>
		</form>
		<form method="POST" action="?/reject" use:rejectEnhance class="contents">
			<input type="hidden" name="id" value={c?.id ?? ""} />
			<button bind:this={rejectBtn} type="submit" class="{action} border border-bad-line bg-transparent font-medium text-bad-ink"
				>Reject<span class="max-md:hidden {KBD} !text-faint">R</span></button
			>
		</form>
		<button
			type="button"
			class="{action} border border-transparent bg-transparent text-muted hover:text-ink max-md:border-line"
			onclick={() => review.move(1)}>Skip<span class="max-md:hidden {KBD} !text-faint">X</span></button
		>
		<span class="ml-4 hidden items-center gap-1.5 lg:flex">
			<span class={KBD}>1–9</span><span class="mr-3">toggle tag</span>
			<span class={KBD}>J K</span><span class="mr-3">next / prev</span>
			<span class={KBD}>U</span><span class="mr-3">undo</span>
			<span class={KBD}>Esc</span><span>queue</span>
		</span>
		<span class="ml-auto hidden text-muted lg:inline">
			{#if review.last}{review.last.kind}ed {review.last.name} · u to undo{/if}
		</span>
		<button
			type="button"
			class="hidden cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-[12.5px] text-muted hover:text-ink lg:inline-flex"
			onclick={() => goto("/composer")}>Staged <span class="font-mono text-accent">{review.stagedCount}</span></button
		>
	</div>
</section>
