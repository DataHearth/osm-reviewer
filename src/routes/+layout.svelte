<script lang="ts">
import "../app.css";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import BottomNav from "$lib/components/BottomNav.svelte";
import TopBar from "$lib/components/TopBar.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { review } from "$lib/stores/review.svelte";

let { children } = $props();

const path = $derived(page.url.pathname);
const onLogin = $derived(path === "/login");

// Keyboard is the primary input: the whole point of the queue is to clear it
// without reaching for the mouse. Handled here so it works on every screen.
function onkeydown(e: KeyboardEvent) {
	if (!auth.signedIn || onLogin) return;
	const t = e.target as HTMLElement | null;
	if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
	const k = e.key;

	if (k === "Escape") {
		goto("/");
		return;
	}
	if (k === "u") {
		e.preventDefault();
		review.undo();
		if (review.last === null) goto("/review");
		return;
	}

	if (path === "/") {
		const rows = review.visible;
		if (k === "j" || k === "ArrowDown") {
			e.preventDefault();
			review.qIdx = Math.min(rows.length - 1, review.qIdx + 1);
		} else if (k === "k" || k === "ArrowUp") {
			e.preventDefault();
			review.qIdx = Math.max(0, review.qIdx - 1);
		} else if (k === "Enter") {
			const c = rows[review.qIdx];
			if (c) {
				review.open(c);
				goto("/review");
			}
		}
		return;
	}

	if (path === "/composer") {
		if (k === "Enter") review.doUpload();
		return;
	}

	if (path !== "/review") return;
	if (k === "a") {
		e.preventDefault();
		review.accept();
	} else if (k === "r") {
		e.preventDefault();
		review.reject();
	} else if (k === "x" || k === "j") {
		e.preventDefault();
		review.move(1);
	} else if (k === "k") {
		e.preventDefault();
		review.move(-1);
	} else if (/^[1-9]$/.test(k)) {
		e.preventDefault();
		review.toggle(parseInt(k, 10) - 1);
	}
}
</script>

<svelte:window {onkeydown} />

<div class="flex h-full flex-col overflow-hidden bg-bg font-mono text-[13px] text-ink">
	{#if onLogin}
		{@render children?.()}
	{:else if auth.signedIn}
		<TopBar />
		{@render children?.()}
		<BottomNav />
	{/if}
</div>
