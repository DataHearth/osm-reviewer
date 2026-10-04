<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { review } from "$lib/stores/review.svelte";

// Phone-only primary navigation: the four session tabs under the thumb.
// Server settings (sources, areas and the rest) sit behind the gear in the
// title bar, and your own settings in the account menu beside it, at every tier.
const path = $derived(`/${page.url.pathname.split("/")[1]}`);

const tabs = $derived([
	{ href: "/", to: review.href("/"), label: "Queue", count: review.pendingCount },
	{ href: "/review", to: review.href("/review"), label: "Review", count: null },
	{ href: "/composer", to: "/composer", label: "Composer", count: review.stagedCount },
	{ href: "/history", to: "/history", label: "History", count: null },
]);

// /review is a pushed detail view on phone: its own back button and action
// bar own the bottom of the screen, so the tab bar steps out of the way.
const hidden = $derived(path === "/review");
</script>

{#if !hidden}
	<nav
		class="relative z-[1100] flex shrink-0 items-stretch border-t border-line bg-bar pb-[env(safe-area-inset-bottom)] font-sans md:hidden"
		aria-label="Sections"
	>
		{#each tabs as t (t.href)}
			{@const on = path === t.href}
			<button
				class="flex min-h-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-[3px] border-0 bg-transparent px-1 text-[12.5px] font-medium {on
					? 'text-ink shadow-[inset_0_2px_0_var(--accent)]'
					: 'text-muted'}"
				aria-current={on ? "page" : undefined}
				onclick={() => goto(t.to)}
			>
				<span>{t.label}</span>
				{#if t.count !== null}
					<span class="font-mono text-[11px] leading-[14px] font-normal tabular-nums {on ? 'text-accent' : 'text-faint'}"
						>{t.count}</span
					>
				{:else}
					<span class="h-[14px]"></span>
				{/if}
			</button>
		{/each}
	</nav>
{/if}
