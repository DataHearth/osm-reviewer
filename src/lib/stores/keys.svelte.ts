import { page } from "$app/state";
import { DEFAULT_BINDINGS } from "$lib/keymap";

/** The signed-in account's key settings, which the root layout load puts on `page.data`. */
class KeysView {
	get bindings() {
		return page.data.keys?.bindings ?? DEFAULT_BINDINGS;
	}

	get vim() {
		return page.data.keys?.vim ?? true;
	}

	get confirmAccept() {
		return page.data.keys?.confirmAccept ?? false;
	}

	get showHints() {
		return page.data.keys?.showHints ?? true;
	}
}

export const keys = new KeysView();
