import { nowStamp } from "$lib/format";
import { post } from "$lib/post";

export type Section = "account" | "osm" | "notif" | "keys";

/**
 * What the settings screen holds that is not a field value: which sections have
 * unsaved edits, when each last saved, and the one-off results the panes report
 * back. The fields themselves live in each pane's own form, which is why one
 * pane's save can never carry another's half-finished channel.
 */
class SettingsState {
	dirty = $state<Record<string, boolean>>({});
	saved = $state<Record<string, string>>({});

	testResult = $state<string | null>(null);
	healthChecked = $state<string | null>(null);
	bundle = $state<string | null>(null);
	disconnected = $state(false);

	get anyDirty() {
		return Object.values(this.dirty).some(Boolean);
	}

	mark(s: Section, on = true) {
		if (this.dirty[s] !== on) this.dirty = { ...this.dirty, [s]: on };
	}

	markSaved(s: Section) {
		this.saved = { ...this.saved, [s]: nowStamp() };
		this.mark(s, false);
	}

	sendTest(on: string[]) {
		this.testResult = on.length
			? "sent · 200 ok · " + on.join(", ")
			: "no channel enabled — nothing sent";
	}

	runHealthCheck() {
		this.healthChecked = nowStamp();
	}

	makeBundle(version: string) {
		this.bundle =
			"review-" +
			version +
			"-diagnostics.tar.gz · 184 KB · logs, config, health (no candidate data)";
	}

	async toggleOsm() {
		this.disconnected = !this.disconnected;
		await post("?/osmConnection", { connected: !this.disconnected });
	}
}

export const settings = new SettingsState();
