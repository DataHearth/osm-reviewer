<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { auth } from "$lib/stores/auth.svelte";
import { review } from "$lib/stores/review.svelte";
import { settings } from "$lib/stores/settings.svelte";
import ScopePicker from "./ScopePicker.svelte";

const path = $derived(`/${page.url.pathname.split("/")[1]}`);
let menu = $state(false);
let closing = $state(false);
let picker = $state(false);

// Dismissal is a timer, not an animation event: the exit class decorates the
// 110ms it takes, but the node comes out whether or not anything painted.
function close() {
	if (!menu || closing) return;
	closing = true;
	setTimeout(() => {
		menu = false;
		closing = false;
	}, 110);
}

// Menus are chrome, not screens: navigating anywhere closes them.
$effect(() => {
	page.url.pathname;
	menu = false;
	closing = false;
	picker = false;
});

// The area under review leads the bar at every tier: it scopes every count to
// its right. Server settings sit behind the gear, your own in the account menu.
const scopeName = $derived(review.scopeArea?.name ?? "All areas");
const firstName = $derived(auth.user?.name.split(" ")[0] ?? "");

const tab = (on: boolean) =>
	"flex shrink-0 cursor-pointer items-center gap-[7px] border-0 bg-transparent px-2.5 text-[13.5px] font-medium whitespace-nowrap transition-colors lg:px-3 " +
	(on ? "text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:text-ink");
const count = (on: boolean) =>
	`font-mono text-[11px] font-normal tabular-nums ${on ? "text-accent" : "text-faint"}`;
const pill = (on: boolean) =>
	"rounded-[4px] px-[5px] font-mono text-[11px] font-normal tabular-nums " +
	(on ? "bg-accent text-accent-ink" : "bg-raised text-accent");

const tabs = $derived([
	{ href: "/", to: review.href("/"), label: "Queue", count: review.pendingCount },
	{ href: "/review", to: review.href("/review"), label: "Review", count: null },
	{ href: "/composer", to: "/composer", label: "Composer", count: review.stagedCount },
	{ href: "/history", to: "/history", label: "History", count: null },
]);

const TITLES: Record<string, string> = {
	"/": "Queue",
	"/review": "Review",
	"/composer": "Composer",
	"/history": "History",
	"/settings": "Settings",
	"/server": "Server",
};
const title = $derived(TITLES[path] ?? "osm-reviewer");

const item = (on: boolean) =>
	"flex min-h-[44px] w-full cursor-pointer items-center justify-between border-0 bg-transparent px-3.5 text-left text-[13px] " +
	(on ? "text-accent" : "text-ink hover:bg-sel");

function go(href: string) {
	menu = false;
	closing = false;
	goto(href);
}

function togglePicker() {
	close();
	picker = !picker;
}
</script>

<header
	class="relative {menu || picker
		? 'z-[1300]'
		: 'z-[1100]'} flex min-h-[56px] shrink-0 items-center gap-2 border-b border-line bg-bar pr-[9px] pl-[13px] font-sans md:min-h-[52px] md:items-stretch md:gap-4 md:px-4 lg:gap-6"
>
	<!-- Tablet and desktop: logo, area and pending count are one button. -->
	<button
		class="-ml-2 flex cursor-pointer items-center gap-2.5 self-center rounded-md border-0 px-2 py-[3px] text-left max-md:hidden {picker
			? 'bg-raised'
			: 'bg-transparent hover:bg-raised'}"
		aria-label="Area: {scopeName}"
		aria-expanded={picker}
		onclick={togglePicker}
	>
		<svg viewBox="0 0 32 32" class="h-[22px] w-[22px] shrink-0" aria-hidden="true"
			><path class="fill-accent" d="M16 30S6 20.5 6 13a10 10 0 0 1 20 0c0 7.5-10 17-10 17Z"></path><path
				class="fill-none stroke-bg"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
				d="m11 13 3.5 3.5L21 10"
			></path></svg
		>
		<span class="flex flex-col leading-[1.15] whitespace-nowrap">
			<span class="text-[14px] font-semibold text-ink"
				>{scopeName} <span class="font-normal {picker ? 'text-accent' : 'text-faint'}">{picker ? "▴" : "▾"}</span></span
			>
			<span class="text-[11px] text-faint">{review.pendingCount} pending</span>
		</span>
	</button>

	<span class="my-[14px] w-px shrink-0 bg-line max-md:hidden"></span>

	<nav class="flex min-w-0 items-stretch max-md:hidden">
		{#each tabs as t (t.href)}
			{@const on = path === t.href}
			<button class={tab(on)} onclick={() => goto(t.to)}>
				{t.label}{#if t.href === "/"}<span class={pill(on)}>{t.count}</span>{:else if t.count !== null}<span class={count(on)}
						>{t.count}</span
					>{/if}
			</button>
		{/each}
	</nav>

	<!-- Phone: screen title over the area. The whole block opens the picker. -->
	<button
		class="flex min-h-[44px] min-w-0 cursor-pointer flex-col items-start justify-center border-0 bg-transparent p-0 text-left leading-[1.2] md:hidden"
		aria-label="{title}, area {scopeName}"
		aria-expanded={picker}
		onclick={togglePicker}
	>
		<span class="flex items-baseline gap-1.5 text-[17px] font-semibold whitespace-nowrap text-ink"
			>{title}{#if path === "/"}<span class="font-mono text-[12px] font-normal text-accent">{review.pendingCount}</span>{/if}</span
		>
		<span class="flex items-center gap-1 text-[12px] whitespace-nowrap text-muted"
			>{scopeName}<span class={picker ? "text-accent" : "text-faint"}>{picker ? "▴" : "▾"}</span></span
		>
	</button>

	<div class="ml-auto flex items-center gap-1 md:gap-3">
		{#if path === "/" && !review.empty}
			<button
				class="flex min-h-[44px] cursor-pointer items-center border-0 bg-transparent px-1 md:hidden"
				onclick={() => (review.filterSheet = true)}
			>
				<span class="flex h-[34px] items-center gap-1.5 rounded-full border border-line px-3 text-[13px] text-ink-2"
					>Filter{#if review.activeFilters}<span class="rounded-[4px] bg-raised px-[5px] font-mono text-[11px] text-accent"
							>{review.activeFilters}</span
						>{/if}</span
				>
			</button>
		{/if}

		<button
			class="flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 md:min-h-0 md:min-w-0"
			aria-label={settings.serverDirty ? "Server settings, unsaved changes" : "Server settings"}
			aria-current={path === "/server" ? "page" : undefined}
			title="Server settings"
			onclick={() => goto("/server")}
		>
			<span
				class="relative flex h-[34px] w-[34px] items-center justify-center rounded-full transition-colors md:h-[32px] md:w-[32px] lg:h-[34px] lg:w-[34px] {path ===
				'/server'
					? 'bg-raised text-accent'
					: 'text-muted hover:bg-raised hover:text-ink'}"
			>
				<svg
					viewBox="0 0 24 24"
					class="h-[18px] w-[18px]"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path
						d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
					></path><circle cx="12" cy="12" r="3"></circle></svg
				>
				{#if settings.serverDirty}<span class="absolute top-[5px] right-[5px] h-[7px] w-[7px] rounded-full bg-warn ring-2 ring-bar"></span>{/if}
			</span>
		</button>

		<button
			class="flex min-h-[44px] shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 md:min-h-0"
			aria-label="Account"
			aria-expanded={menu}
			onclick={() => (menu ? close() : ((picker = false), (menu = true)))}
		>
			<span
				class="flex items-center gap-2 rounded-full lg:py-1 lg:pr-2.5 lg:pl-1 {menu
					? 'bg-raised ring-1 ring-accent'
					: 'lg:bg-raised'}"
			>
				<span
					class="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-raised text-[11px] font-semibold tracking-[0.02em] md:h-[32px] md:w-[32px] lg:h-[26px] lg:w-[26px] lg:bg-edge lg:text-[10.5px] {menu
						? 'text-accent'
						: 'text-ink-2'}">{auth.initials}</span
				>
				<span class="text-[12.5px] text-ink-2 max-lg:hidden">{firstName}</span>
				<span class="text-faint max-lg:hidden">▾</span>
			</span>
		</button>
	</div>

	<ScopePicker bind:open={picker} />

	{#if menu}
		<button
			class="fixed inset-0 z-1 cursor-default border-0 bg-bg/60 {closing ? 'm-fade-out' : 'm-fade'}"
			aria-label="Close menu"
			onclick={close}
		></button>
		<div
			class="absolute top-full right-2.5 z-2 mt-1.5 w-[220px] origin-top-right overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-[0_18px_44px_rgba(0,0,0,0.6)] {closing
				? 'm-pop-out'
				: 'm-pop'}"
		>
			<div class="border-b border-line-soft px-3.5 py-2.5">
				<div class="truncate text-[13.5px] font-medium text-ink">{auth.user?.name}</div>
				<div class="mt-0.5 truncate text-[11px] text-faint">{auth.user?.email}</div>
				<div class="mt-1 text-[11px] text-faint">
					{auth.user?.role} · signed in {auth.session?.at}
				</div>
			</div>
			<button class="{item(path === '/settings')} border-b border-line-soft" onclick={() => go("/settings")}>
				<span class="flex flex-col py-1.5 leading-[1.3]"
					>Profile &amp; settings<span class="text-[11px] text-faint">account, OSM account, shortcuts</span></span
				>
				{#if settings.userDirty}<span class="text-[11.5px] text-warn">Unsaved</span>{/if}
			</button>
			<button
				class="flex min-h-[44px] w-full cursor-pointer items-center border-0 bg-transparent px-3.5 text-left text-[13px] text-muted hover:text-ink"
				onclick={() => {
					menu = false;
					closing = false;
					auth.signOut();
					goto("/login");
				}}>Sign out</button
			>
		</div>
	{/if}
</header>
