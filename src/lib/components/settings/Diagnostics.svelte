<script lang="ts">
import { ghost, toneDot } from "$lib/format";
import { settings } from "$lib/stores/settings.svelte";
import type { MetricRow } from "$lib/types";
import Pane from "./Pane.svelte";

let {
	instance,
	health,
	sso,
}: {
	instance: {
		version: string;
		rev: string;
		image: string;
		runtime: string;
		uptime: string;
		db: string;
	};
	health: MetricRow[];
	sso: { enabled: boolean; provider: string; host: string; clientId: string; scopes: string };
} = $props();

const facts = $derived([
	["version", instance.version + " · " + instance.rev],
	["image", instance.image],
	["runtime", instance.runtime],
	["uptime", instance.uptime],
	["database", instance.db],
	["identity provider", sso.enabled ? sso.provider + " · " + sso.host : "not configured"],
	["oidc client", sso.enabled ? sso.clientId + " · " + sso.scopes : "not configured"],
]);

const tally = $derived.by(() => {
	const n = (tone: string) => health.filter((h) => h[3] === tone).length;
	return [
		[n("ok"), "ok"],
		[n("warn"), n("warn") === 1 ? "warning" : "warnings"],
		[n("bad"), "failing"],
	]
		.filter(([c]) => c)
		.map(([c, label]) => c + " " + label)
		.join(", ");
});
</script>

<Pane title="diagnostics" desc="What the container reports about itself. Admin only — everything here is instance-wide.">
	<div class="grid gap-x-3 gap-y-1.5 text-[12px] md:grid-cols-[168px_minmax(0,1fr)]">
		{#each facts as f (f[0])}
			<span class="text-faint">{f[0]}</span>
			<span class="break-all text-ink-2">{f[1]}</span>
		{/each}
	</div>

	<div class="overflow-hidden rounded-md border border-line">
		<div class="border-b border-line-soft bg-head px-3 py-2 text-[10.5px] tracking-[0.08em] text-muted">HEALTH</div>
		{#each health as h (h[0])}
			<div
				class="grid items-baseline gap-x-3 gap-y-0.5 border-b border-line-faint px-3 py-2 last:border-b-0 md:grid-cols-[168px_150px_minmax(0,1fr)]"
			>
				<span class="flex items-center gap-2 text-[12px] text-faint">
					<span class="h-[6px] w-[6px] shrink-0 rounded-full {toneDot(h[3] ?? null)}"></span>{h[0]}
				</span>
				<span class="text-[12px] {h[3] ? 'text-ink' : 'text-faint'}">{h[1]}</span>
				<span class="text-[11.5px] break-all text-faint">{h[2] ?? ""}</span>
			</div>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-2.5 border-t border-line-faint pt-4">
		<button class="{ghost(false)} max-md:min-h-[44px]" onclick={() => settings.runHealthCheck()}>run health check</button>
		<a class="{ghost(false)} max-md:min-h-[44px]" href="/server/diagnostics" download>build diagnostics bundle</a>
		<span class="text-[11.5px] text-faint">JSON with every secret redacted</span>
	</div>

	{#if settings.healthChecked}
		<div class="m-rise text-[11.5px] text-ok-ink">checked {settings.healthChecked} · {tally}</div>
	{/if}
</Pane>
