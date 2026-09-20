<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { auth } from "$lib/stores/auth.svelte";
import { review } from "$lib/stores/review.svelte";
import { settings } from "$lib/stores/settings.svelte";

const path = $derived(page.url.pathname);
const settingsDirty = $derived(settings.anyDirty);
let menu = $state(false);
let closing = $state(false);

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

// The menu is chrome, not a screen: navigating anywhere closes it.
$effect(() => {
	path;
	menu = false;
	closing = false;
});

// Phone gets BottomNav instead of these tabs, so the header there is just a
// title bar: the current screen, plus the area this session is scoped to.
const tab = (on: boolean) =>
	"shrink-0 cursor-pointer rounded-md border-0 px-[11px] py-[5px] text-[12.5px] whitespace-nowrap transition-colors " +
	(on ? "bg-line text-accent" : "bg-transparent text-muted hover:text-ink");

const tabs = $derived([
	{ href: "/", label: "queue", count: review.pendingCount },
	{ href: "/review", label: "review", count: null },
	{ href: "/composer", label: "composer", count: review.stagedCount },
	{ href: "/history", label: "history", count: null },
]);

const admin = [
	{ href: "/sources", label: "sources" },
	{ href: "/areas", label: "areas" },
];

const TITLES: Record<string, string> = {
	"/": "queue",
	"/review": "review",
	"/composer": "composer",
	"/history": "history",
	"/sources": "sources",
	"/areas": "areas",
	"/settings": "settings",
};
const title = $derived(TITLES[path] ?? "candidate-review");

function openPendingArea() {
	review.areaId = "tls";
	review.draft = null;
	goto("/areas");
}

function go(href: string) {
	menu = false;
	closing = false;
	goto(href);
}
</script>

<header
	class="relative z-[1100] flex min-h-[46px] shrink-0 items-center gap-2 border-b border-line bg-bar px-[13px] md:min-h-[44px] md:gap-4 md:px-[14px]"
>
	<span class="font-semibold tracking-[0.02em] whitespace-nowrap text-accent max-md:text-[13.5px]"
		><span class="md:hidden">{title}</span><span class="max-md:hidden">candidate-review</span></span
	>

	<nav class="flex min-w-0 gap-[2px] max-md:hidden">
		{#each tabs as t (t.href)}
			<button class={tab(path === t.href)} onclick={() => goto(t.href)}>
				{t.label}{#if t.count !== null}&nbsp;<span class="opacity-60">{t.count}</span>{/if}
			</button>
		{/each}
		<span class="mx-[6px] h-[18px] w-px self-center bg-line"></span>
		{#each admin as t (t.href)}
			<button class={tab(path === t.href)} onclick={() => goto(t.href)}>{t.label}</button>
		{/each}
	</nav>

	<div class="ml-auto flex items-center gap-1.5 md:gap-2.5">
		<button
			class="flex min-h-[36px] cursor-pointer items-center border-0 bg-transparent text-[11px] whitespace-nowrap text-faint hover:text-muted max-md:min-h-[40px] max-md:text-[11.5px] md:max-lg:hidden"
			onclick={openPendingArea}
		>
			{review.pendingCount} pending<span class="max-md:hidden"> · Toulouse ▸</span>
		</button>

		<button
			class="flex h-[28px] w-[28px] shrink-0 cursor-pointer items-center justify-center rounded-full border text-[10.5px] tracking-[0.02em] max-md:h-[32px] max-md:w-[32px] {menu
				? 'border-edge-strong bg-line text-accent'
				: 'border-edge bg-raised text-muted hover:text-ink'}"
			aria-label="Account"
			aria-expanded={menu}
			onclick={() => (menu ? close() : (menu = true))}>{auth.initials}</button
		>
	</div>

	{#if menu}
		<button
			class="fixed inset-0 z-1 cursor-default border-0 bg-bg/60 {closing ? 'm-fade-out' : 'm-fade'}"
			aria-label="Close menu"
			onclick={close}
		></button>
		<div
			class="absolute top-full right-2.5 z-2 mt-1.5 w-[212px] origin-top-right overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-[0_18px_44px_rgba(0,0,0,0.6)] {closing
				? 'm-pop-out'
				: 'm-pop'}"
		>
			<div class="border-b border-line-soft px-3.5 py-2.5">
				<div class="truncate text-[12.5px] text-ink">{auth.user?.name}</div>
				<div class="mt-0.5 truncate text-[11px] text-faint">{auth.user?.email}</div>
				<div class="mt-1 text-[11px] text-faint">
					{auth.user?.role} · signed in {auth.session?.at}
				</div>
			</div>
			<button
				class="flex min-h-[44px] w-full cursor-pointer items-center justify-between border-0 border-b border-line-soft bg-transparent px-3.5 text-left text-[12.5px] {path ===
				'/settings'
					? 'text-accent'
					: 'text-ink'}"
				onclick={() => go("/settings")}
			>
				settings
				{#if settingsDirty}<span class="text-[11px] text-warn">unsaved</span>{/if}
			</button>
			<button
				class="flex min-h-[44px] w-full cursor-pointer items-center border-0 bg-transparent px-3.5 text-left text-[12.5px] text-muted hover:text-ink"
				onclick={() => {
					menu = false;
					closing = false;
					auth.signOut();
					goto("/login");
				}}>sign out</button
			>
		</div>
	{/if}
</header>
