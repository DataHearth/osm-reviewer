export interface Toast {
	id: number;
	ok: boolean;
	text: string;
	closing: boolean;
}

const SHOWN_MS = 5000;
/** Matches `m-fade-out`. */
const EXIT_MS = 110;

let next = 0;

class Toasts {
	list = $state<Toast[]>([]);

	show(text: string, ok = true) {
		const id = next++;
		this.list.push({ id, ok, text, closing: false });
		setTimeout(() => this.dismiss(id), SHOWN_MS);
	}

	dismiss(id: number) {
		const t = this.list.find((x) => x.id === id);
		if (!t || t.closing) return;
		t.closing = true;
		setTimeout(() => {
			this.list = this.list.filter((x) => x.id !== id);
		}, EXIT_MS);
	}
}

export const toasts = new Toasts();
