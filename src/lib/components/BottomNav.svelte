<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { review } from "$lib/stores/review.svelte";

// Phone-only primary navigation. The top strip put six destinations in a
// horizontal scroller, so sources and areas sat off the right edge with no
// affordance; here the four session tabs are under the thumb and the two
// admin screens live behind "more".
const path = $derived(page.url.pathname);
let more = $state(false);
let closing = $state(false);

function closeMore() {
	if (!more || closing) return;
	closing = true;
	setTimeout(() => {
		more = false;
		closing = false;
	}, 110);
}

const tabs = $derived([
	{ href: "/", label: "queue", count: review.pendingCount },
	{ href: "/review", label: "review", count: null },
	{ href: "/composer", label: "composer", count: review.stagedCount },
	{ href: "/history", label: "history", count: null },
]);

const admin = [
	{ href: "/sources", label: "sources" },
	{ href: "/areas", label: "areas" },
	{ href: "/settings", label: "settings" },
];

const adminOn = $derived(path === "/sources" || path === "/areas" || path === "/settings");

// /review is a pushed detail view on phone: its own back button and action
// bar own the bottom of the screen, so the tab bar steps out of the way.
const hidden = $derived(path === "/review");

function go(href: string) {
	more = false;
	closing = false;
	goto(href);
}
</script>

{#if !hidden}
	<nav
		class="relative z-[1100] flex shrink-0 items-stretch border-t border-line bg-bar pb-[env(safe-area-inset-bottom)] md:hidden"
		aria-label="Sections"
	>
	{#if more}
		<button
			class="fixed inset-0 z-1 cursor-default border-0 bg-bg/70 {closing ? 'm-fade-out' : 'm-fade'}"
			aria-label="Close menu"
			onclick={closeMore}
		></button>
		<div
			class="absolute right-1.5 bottom-full z-2 mb-2 w-[176px] origin-bottom-right overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-[0_18px_44px_rgba(0,0,0,0.6)] {closing
				? 'm-pop-out'
				: 'm-pop'}"
		>
			{#each admin as t (t.href)}
				<button
					class="flex min-h-[48px] w-full cursor-pointer items-center border-0 border-b border-line-soft bg-transparent px-[15px] text-left text-[13px] last:border-b-0 {path ===
					t.href
						? 'text-accent'
						: 'text-ink'}"
					onclick={() => go(t.href)}>{t.label}</button
				>
			{/each}
		</div>
	{/if}

	{#each tabs as t (t.href)}
		{@const on = path === t.href}
		<button
			class="flex min-h-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-[3px] border-0 bg-transparent px-1 text-[11.5px] {on
				? 'text-accent shadow-[inset_0_2px_0_var(--accent)]'
				: 'text-muted'}"
			aria-current={on ? "page" : undefined}
			onclick={() => goto(t.href)}
		>
			<span>{t.label}</span>
			{#if t.count !== null}
				<span
					class="rounded-full px-[6px] py-px text-[10.5px] tabular-nums {on ? 'bg-line text-accent' : 'bg-raised text-faint'}"
					>{t.count}</span
				>
			{:else}
				<span class="h-[14px]"></span>
			{/if}
		</button>
	{/each}

	<button
		class="flex min-h-[56px] w-[52px] shrink-0 cursor-pointer flex-col items-center justify-center gap-[3px] border-0 border-l border-line-soft bg-transparent text-[11.5px] {adminOn ||
		more
			? 'text-accent'
			: 'text-muted'}"
		aria-label="More sections"
		aria-expanded={more}
		onclick={() => (more ? closeMore() : (more = true))}
	>
		<span class="text-[16px] leading-none">···</span>
		<span class="h-[14px]"></span>
	</button>
	</nav>
{/if}
