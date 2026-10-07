<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import AreaDetail from "$lib/components/areas/AreaDetail.svelte";
import AreaForm from "$lib/components/areas/AreaForm.svelte";
import AreaOverview from "$lib/components/areas/AreaOverview.svelte";
import AreaRail from "$lib/components/areas/AreaRail.svelte";
import Diagnostics from "$lib/components/settings/Diagnostics.svelte";
import Notifications from "$lib/components/settings/Notifications.svelte";
import Users from "$lib/components/settings/Users.svelte";
import OfficialPane from "$lib/components/sources/OfficialPane.svelte";
import SourceDetail from "$lib/components/sources/SourceDetail.svelte";
import SourceForm from "$lib/components/sources/SourceForm.svelte";
import SourceOverview from "$lib/components/sources/SourceOverview.svelte";
import SourceRail from "$lib/components/sources/SourceRail.svelte";
import { railRow } from "$lib/format";
import { review } from "$lib/stores/review.svelte";
import { settings } from "$lib/stores/settings.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// Everything instance-wide, shared by every account — behind the gear. Per-
// account settings live at /settings, in the account menu. Sources and areas
// are lists with their own rails, so selecting one drills the rail into that
// list ("‹ server" backs out); the open section is in the URL (?s=) so other
// screens can link straight to it.
const LISTS = ["sources", "areas"];
let drill = $state(false);
let pane = $state<"rail" | "detail">("rail");
let cur = $state<string | null>(null);

// The drill animates as a push: the incoming layer slides over the outgoing
// one, which stays mounted (absolute, inert) for the 200ms of m-push-out /
// m-back-out and is then dropped on a timer.
let prev = $state<"menu" | "list" | null>(null);
let dir = $state<"fwd" | "back">("fwd");
let timer: ReturnType<typeof setTimeout> | undefined;
function setDrill(v: boolean) {
	if (v === drill) return;
	clearTimeout(timer);
	prev = drill ? "list" : "menu";
	dir = v ? "fwd" : "back";
	drill = v;
	timer = setTimeout(() => (prev = null), 200);
}

const SECTIONS = $derived([
	["sources", "sources", `${data.sources.length} sources`],
	["areas", "areas", `${data.areas.length} areas`],
	["notif", "notifications", "ntfy, webhook, email"],
	["users", "users", "accounts, roles, access"],
	["diag", "diagnostics", "version, health, bundle"],
]);

// Users and diagnostics are admin only.
const sections = $derived(
	data.user.role === "admin"
		? SECTIONS
		: SECTIONS.filter((s) => s[0] !== "users" && s[0] !== "diag"),
);
const qs = $derived(page.url.searchParams.get("s"));
const sec = $derived(sections.find((s) => s[0] === (cur ?? qs))?.[0] ?? sections[0][0]);
const isList = $derived(LISTS.includes(sec));

// A link in (Manage areas ›) lands on the list itself, not the section menu.
$effect(() => {
	const q = qs;
	if (!q) return;
	cur = q;
	if (LISTS.includes(q)) drill = true;
});

const label = $derived(
	sec === "sources"
		? review.srcDraft
			? review.srcDraft.official
				? "official source"
				: "new source"
			: review.srcId
				? (data.sources.find((s) => s.id === review.srcId)?.name ?? "")
				: "All sources"
		: sec === "areas"
			? review.draft
				? "new area"
				: review.areaId
					? (data.areas.find((a) => a.id === review.areaId)?.name ?? "")
					: "All areas"
			: (sections.find((s) => s[0] === sec)?.[1] ?? ""),
);

function open(id: string) {
	cur = id;
	if (id !== qs) goto(`/server?s=${id}`);
	if (LISTS.includes(id)) setDrill(true);
	else pane = "detail";
}

const enterCls = $derived(prev ? (dir === "fwd" ? "z-2 m-push" : "z-1 m-back") : "");
const exitCls = $derived(dir === "fwd" ? "z-1 m-push-out" : "z-2 m-back-out");
</script>

{#snippet menu()}
	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class="border-b border-line-soft px-[14px] py-2.5">
			<div class="text-[10.5px] tracking-[0.1em] text-muted">SERVER</div>
			<div class="mt-1 truncate text-[12px] text-ink">{data.release.host} · {data.release.version}</div>
		</div>
		{#each sections as s (s[0])}
			<button class="{railRow(sec === s[0])} max-md:min-h-[56px]" onclick={() => open(s[0])}>
				<div class="flex items-center justify-between gap-2">
					<span class="text-[12.5px] {sec === s[0] ? 'text-accent' : 'text-ink'}">{s[1]}</span>
					{#if LISTS.includes(s[0])}<span class="text-[13px] leading-none text-faint">›</span>{/if}
				</div>
				<div class="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
					<span class="truncate">{s[2]}</span>
					{#if settings.dirty[s[0]]}<span class="shrink-0 text-warn">unsaved</span>{/if}
				</div>
			</button>
		{/each}
		<p class="px-[14px] py-3 text-[11px] leading-relaxed text-faint">
			Shared by everyone on this instance. Your own account, OSM identity and keys are in the account menu.
		</p>
	</div>
{/snippet}

{#snippet list()}
	<button
		class="flex min-h-[40px] w-full shrink-0 cursor-pointer items-center gap-1 border-0 border-b border-line-soft bg-panel px-[14px] text-left text-[12.5px] text-accent max-md:min-h-[44px]"
		onclick={() => setDrill(false)}><span class="text-[15px] leading-none">‹</span> server</button
	>
	<div
		class="min-h-0 flex-1 overflow-y-auto"
		onclick={(e) => {
			if ((e.target as HTMLElement).closest("button")) pane = "detail";
		}}
		role="presentation"
	>
		{#if sec === "sources"}
			<SourceRail />
		{:else}
			<AreaRail />
		{/if}
	</div>
{/snippet}

<section
	class="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[232px_minmax(0,1fr)] md:overflow-hidden lg:grid-cols-[288px_minmax(0,1fr)]"
>
	<div
		class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel md:border-r md:border-line {pane === 'detail'
			? 'max-md:hidden'
			: ''}"
	>
		{#key drill}
			<div class="relative flex min-h-0 flex-1 flex-col bg-panel {enterCls}">
				{#if drill && isList}{@render list()}{:else}{@render menu()}{/if}
			</div>
		{/key}
		{#if prev}
			<div class="pointer-events-none absolute inset-0 flex flex-col bg-panel {exitCls}" aria-hidden="true" inert>
				{#if prev === "list" && isList}{@render list()}{:else}{@render menu()}{/if}
			</div>
		{/if}
	</div>

	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto {pane === 'rail' ? 'max-md:hidden' : ''}">
		<div class="sticky top-0 z-2 flex items-center gap-2 border-b border-line-soft bg-panel px-2.5 md:hidden">
			<button
				class="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-[12.5px] whitespace-nowrap text-accent"
				onclick={() => (pane = "rail")}><span class="text-[15px] leading-none">‹</span> {isList ? sec : "server"}</button
			>
			<span class="min-w-0 flex-1 truncate text-right text-[11.5px] text-faint">{label}</span>
		</div>

		{#if sec === "sources"}
			{#if review.srcDraft?.official}
				{@const offered = data.offered.find((o) => o.file === review.srcDraft?.official)}
				{#if offered}
					{#key offered.file}
						<OfficialPane form={data.forms.official} official={offered} />
					{/key}
				{/if}
			{:else if review.srcDraft}
				<SourceForm form={data.forms.source} mappings={data.mappings} />
			{:else if review.srcId}
				<SourceDetail />
			{:else}
				<SourceOverview />
			{/if}
		{:else if sec === "areas"}
			{#if review.draft}
				<AreaForm form={data.forms.area} />
			{:else if review.areaId}
				<AreaDetail />
			{:else}
				<AreaOverview />
			{/if}
		{:else}
			{#key sec}
				<div class="m-fade min-h-full">
					{#if sec === "notif"}
						<Notifications form={data.forms.notif} />
					{:else if sec === "users"}
						<Users {data} />
					{:else if data.instance}
						<Diagnostics instance={data.instance} health={data.health} sso={data.sso} />
					{/if}
				</div>
			{/key}
		{/if}
	</div>
</section>
