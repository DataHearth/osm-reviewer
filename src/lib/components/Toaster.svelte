<script lang="ts">
import { toasts } from "$lib/stores/toast.svelte";
</script>

<div
	role="status"
	class="pointer-events-none fixed right-4 bottom-4 z-[1300] flex flex-col items-end gap-2 max-md:inset-x-4 max-md:bottom-[calc(env(safe-area-inset-bottom)+68px)]"
>
	{#each toasts.list as t (t.id)}
		<button
			class="pointer-events-auto flex max-w-[360px] cursor-pointer items-baseline gap-2.5 rounded-sm border bg-panel px-3 py-2 text-left text-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.5)] max-md:max-w-none max-md:self-stretch {t.ok
				? 'border-ok-line text-ink'
				: 'border-bad-line text-bad-ink'} {t.closing ? 'm-fade-out' : 'm-lift'}"
			onclick={() => toasts.dismiss(t.id)}
		>
			<span class={t.ok ? "text-ok" : "text-bad"}>{t.ok ? "●" : "!"}</span>
			<span>{t.text}</span>
		</button>
	{/each}
</div>
