<script lang="ts">
import "../app.css";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import BottomNav from "$lib/components/BottomNav.svelte";
import TopBar from "$lib/components/TopBar.svelte";
import { auth } from "$lib/stores/auth.svelte";
import { keys } from "$lib/stores/keys.svelte";
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
	// Leave the browser's own chords alone: ctrl+r is a reload, not a reject.
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	const k = e.key;
	const b = keys.bindings;
	const vim = keys.vim;

	if (k === b.back) {
		goto("/");
		return;
	}
	if (k === b.undo) {
		e.preventDefault();
		review.undo();
		if (review.last === null) goto("/review");
		return;
	}

	if (path === "/") {
		const rows = review.visible;
		if ((vim && k === b.down) || k === "ArrowDown") {
			e.preventDefault();
			review.qIdx = Math.min(rows.length - 1, review.qIdx + 1);
		} else if ((vim && k === b.up) || k === "ArrowUp") {
			e.preventDefault();
			review.qIdx = Math.max(0, review.qIdx - 1);
		} else if (k === b.open) {
			const c = rows[review.qIdx];
			if (c) {
				review.open(c);
				goto("/review");
			}
		}
		return;
	}

	if (path === "/composer") {
		if (k === b.upload) review.doUpload();
		return;
	}

	if (path !== "/review") return;
	if (k === b.accept) {
		e.preventDefault();
		// ponytail: the browser's own confirm — Enter accepts, Esc cancels, so it stays on the keyboard.
		const ask = keys.confirmAccept && review.candidate && !review.blockedReason;
		if (!ask || confirm("Accept the selected tags?")) review.accept();
	} else if (k === b.reject) {
		e.preventDefault();
		review.reject();
	} else if (k === b.skip || (vim && k === b.down)) {
		e.preventDefault();
		review.move(1);
	} else if (vim && k === b.up) {
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
