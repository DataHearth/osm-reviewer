<script lang="ts">
// "Run now" for a source or an area: toasts whether the request took, shows the run
// in progress, and reloads until it ends so the runs and counts arrive on their own.
import { invalidateAll } from "$app/navigation";
import { ghost } from "$lib/format";
import type { PostResult } from "$lib/post";
import { toasts } from "$lib/stores/toast.svelte";

let {
	label,
	name,
	running,
	onrun,
}: { label: string; name: string; running: boolean; onrun: () => Promise<PostResult> } = $props();

const POLL_MS = 3000;

let asking = $state(false);
let wasRunning = false;

async function run() {
	asking = true;
	const res = await onrun();
	asking = false;
	if (res.ok) toasts.show(`${name}: run queued`);
	else toasts.show(`${name}: ${res.message}`, false);
}

$effect(() => {
	if (!running) {
		if (wasRunning) toasts.show(`${name}: run finished`);
		wasRunning = false;
		return;
	}
	wasRunning = true;
	const t = setInterval(invalidateAll, POLL_MS);
	return () => clearInterval(t);
});
</script>

<button class="{ghost(running)} disabled:cursor-wait" disabled={running || asking} onclick={run}>
	{#if running}<span class="motion-safe:animate-pulse">running…</span>{:else}{label}{/if}
</button>
