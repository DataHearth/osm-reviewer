<script lang="ts">
let { label, hint = "", cls = "", children } = $props();
</script>

<div class="flex flex-col gap-[5px] {cls}">
	<span class="text-[11px] tracking-[0.06em] text-faint">{label}</span>
	{@render children?.()}
	{#if hint}<span class="text-[11px] leading-relaxed text-faint">{hint}</span>{/if}
</div>
