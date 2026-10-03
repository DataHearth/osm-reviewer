import { invalidateAll } from "$app/navigation";
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

	healthChecked = $state<string | null>(null);
	disconnected = $state(false);

	/** The account menu's sections (/settings) and the gear's (/server) flag apart. */
	get userDirty() {
		return !!(this.dirty.account || this.dirty.osm || this.dirty.keys);
	}

	get serverDirty() {
		return !!this.dirty.notif;
	}

	mark(s: Section, on = true) {
		if (this.dirty[s] !== on) this.dirty = { ...this.dirty, [s]: on };
	}

	markSaved(s: Section) {
		this.saved = { ...this.saved, [s]: nowStamp() };
		this.mark(s, false);
	}

	/** The health rows are computed by the page load, so re-running it is the check. */
	async runHealthCheck() {
		await invalidateAll();
		this.healthChecked = nowStamp();
	}

	async toggleOsm() {
		this.disconnected = !this.disconnected;
		await post("?/osmConnection", { connected: !this.disconnected });
	}
}

export const settings = new SettingsState();
