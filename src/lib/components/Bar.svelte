<script lang="ts">
let {
	value,
	max,
	label,
	class: cls = "",
}: { value: number; max: number; label: string; class?: string } = $props();
</script>

<span
	role="meter"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={max}
	aria-valuenow={value}
	class="block h-1.5 overflow-hidden rounded-full bg-line {cls}"
>
	<span class="block h-full rounded-full bg-accent" style:width="{Math.min(100, (value / max) * 100)}%"></span>
</span>
