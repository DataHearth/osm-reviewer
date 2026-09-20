<script lang="ts">
import Account from "$lib/components/settings/Account.svelte";
import Diagnostics from "$lib/components/settings/Diagnostics.svelte";
import Notifications from "$lib/components/settings/Notifications.svelte";
import OsmAccount from "$lib/components/settings/OsmAccount.svelte";
import Shortcuts from "$lib/components/settings/Shortcuts.svelte";
import { railRow } from "$lib/format";
import { settings } from "$lib/stores/settings.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// Same two-pane shape as sources: a rail of sections beside the open one,
// and on a phone the two are screens rather than columns.
let sec = $state("account");
let pane = $state<"rail" | "detail">("rail");

const SECTIONS = [
	["account", "account", "name, email, password"],
	["osm", "OSM account", "changeset identity"],
	["notif", "notifications", "ntfy, webhook, email"],
	["keys", "shortcuts", "the keyboard map"],
	["diag", "diagnostics", "version, health, bundle"],
];

// Diagnostics is instance-wide, so reviewers do not get it.
const sections = $derived(
	data.user.role === "admin" ? SECTIONS : SECTIONS.filter((s) => s[0] !== "diag"),
);
const current = $derived(sections.find((s) => s[0] === sec) ?? sections[0]);

function open(id: string) {
	sec = id;
	pane = "detail";
}
</script>

<section
	class="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[232px_minmax(0,1fr)] md:overflow-hidden lg:grid-cols-[288px_minmax(0,1fr)]"
>
	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto bg-panel md:border-r md:border-line {pane === 'detail' ? 'max-md:hidden' : ''}">
		<div class="border-b border-line-soft px-[14px] py-2.5">
			<div class="text-[10.5px] tracking-[0.1em] text-muted">SETTINGS</div>
			<div class="mt-1 truncate text-[12px] text-ink">{data.user.email}</div>
		</div>
		{#each sections as s (s[0])}
			<button class="{railRow(sec === s[0])} max-md:min-h-[56px]" onclick={() => open(s[0])}>
				<div class="text-[12.5px] {sec === s[0] ? 'text-accent' : 'text-ink'}">{s[1]}</div>
				<div class="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
					<span class="truncate">{s[2]}</span>
					{#if settings.dirty[s[0]]}<span class="shrink-0 text-warn">unsaved</span>{/if}
				</div>
			</button>
		{/each}
		<p class="px-[14px] py-3 text-[11px] leading-relaxed text-faint">
			Sources and areas have their own screens — this is the account and the instance.
		</p>
	</div>

	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto {pane === 'rail' ? 'max-md:hidden' : ''}">
		<div class="sticky top-0 z-2 flex items-center gap-2 border-b border-line-soft bg-panel px-2.5 md:hidden">
			<button
				class="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent px-1 text-[12.5px] whitespace-nowrap text-accent"
				onclick={() => (pane = "rail")}><span class="text-[15px] leading-none">‹</span> settings</button
			>
			<span class="min-w-0 flex-1 truncate text-right text-[11.5px] text-faint">{current[1]}</span>
		</div>

		{#key sec}
			<div class="m-fade min-h-full">
				{#if sec === "account"}
					<Account {data} />
				{:else if sec === "osm"}
					<OsmAccount {data} />
				{:else if sec === "notif"}
					<Notifications form={data.forms.notif} />
				{:else if sec === "keys"}
					<Shortcuts form={data.forms.keys} keymap={data.keymap} />
				{:else}
					<Diagnostics instance={data.instance} health={data.health} sso={data.sso} />
				{/if}
			</div>
		{/key}
	</div>
</section>
