import type { Candidate, TagOp, Tone } from "./types";

export const comma = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Read a display number back out of a formatted fixture string ("18,402"). */
export const num = (v: string | number) => {
	const n = parseFloat(String(v).replace(/[, ]/g, ""));
	return isNaN(n) ? 0 : n;
};

export const confTone = (v: number): Tone => (v >= 0.85 ? "ok" : v >= 0.6 ? "warn" : "bad");
export const confText = (v: number) =>
	v >= 0.85 ? "text-ok" : v >= 0.6 ? "text-warn" : "text-bad";
export const confBg = (v: number) => (v >= 0.85 ? "bg-ok" : v >= 0.6 ? "bg-warn" : "bg-bad");

export const toneText = (t: Tone | undefined) =>
	t === "ok" ? "text-ok" : t === "warn" ? "text-warn" : t === "bad" ? "text-bad" : "text-ink";

export const healthTone = (h: "ok" | "warn" | "error"): Tone =>
	h === "ok" ? "ok" : h === "warn" ? "warn" : "bad";
export const toneDot = (t: Tone) =>
	t === "ok" ? "bg-ok" : t === "warn" ? "bg-warn" : t === "bad" ? "bg-bad" : "bg-dim";

export const OP_SIGN: Record<TagOp, string> = { add: "+", mod: "~", del: "-" };
/** 3 px rule — fill only, so the op reads before the text does. */
export const OP_BAR: Record<TagOp, string> = {
	add: "border-l-add",
	mod: "border-l-mod",
	del: "border-l-del",
};
export const OP_BG: Record<TagOp, string> = {
	add: "bg-add-bg",
	mod: "bg-mod-bg",
	del: "bg-del-bg",
};
/** Glyph ink — lighter than the bar, because it has to pass as text. */
export const OP_INK: Record<TagOp, string> = {
	add: "text-ok-ink",
	mod: "text-mod",
	del: "text-bad-ink",
};

export const typeLabel = (t: Candidate["type"]) =>
	t === "new" ? "new poi" : t === "closure" ? "closure" : "tag update";
export const typeSlug = (t: Candidate["type"]) =>
	t === "new" ? "new-poi" : t === "closure" ? "closure" : "tag-update";
export const typeText = (t: Candidate["type"]) =>
	t === "new" ? "text-ok" : t === "closure" ? "text-del" : "text-muted";

export const statusText = (s: string) =>
	s === "active" ? "text-ok-ink" : s === "paused" ? "text-warn" : "text-faint";
export const statusPill = (s: string) =>
	s === "active"
		? "bg-ok-bg text-ok-ink"
		: s === "paused"
			? "bg-warn-bg text-warn"
			: "bg-raised text-muted";

export const osmUrl = (osmId: string) =>
	"https://www.openstreetmap.org/" + (osmId.startsWith("node/") ? osmId : "");

const pad = (n: number) => String(n).padStart(2, "0");

/** DD-MM-YYYY — the only date format the app displays. */
export const fmtDate = (d: Date) =>
	pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + d.getFullYear();

/** DD-MM-YYYY HH:MM, in the operator's own clock — every displayed instant. */
export const stamp = (d: Date) => fmtDate(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());

export const nowStamp = () => stamp(new Date());

/** Sort key for a DD-MM-YYYY HH:MM string that has already been formatted. */
export const stampKey = (w: string) => {
	const m = String(w).match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
	return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : 0;
};

// ── Shared control shapes ─────────────────────────────────────────────────────
/** A row in the sources / areas rail. */
export const railRow = (on: boolean) =>
	"block w-full cursor-pointer border-b border-line-faint px-[14px] py-2.5 text-left " +
	(on ? "bg-sel shadow-[inset_2px_0_0_var(--accent)]" : "bg-transparent hover:bg-panel");

/** Segmented / secondary button. */
export const ghost = (on: boolean) =>
	"cursor-pointer rounded-sm px-[11px] py-1 text-[12px] whitespace-nowrap " +
	(on
		? "border border-edge-strong bg-line text-accent"
		: "border border-line bg-transparent text-muted hover:text-ink");

/** The [x] / [ ] checkbox the whole app uses instead of a real one. */
export const boxBtn = (on: boolean) =>
	"cursor-pointer border-0 bg-transparent p-0 text-left text-[12.5px] " +
	(on ? "text-accent" : "text-faint");

export const railAdd = (on: boolean) =>
	"cursor-pointer rounded-sm px-2 py-[3px] font-mono text-[11px] tracking-normal whitespace-nowrap " +
	(on
		? "border border-edge-strong bg-line text-accent"
		: "border border-line bg-transparent text-faint hover:text-ink");

export const primaryBtn = (ready: boolean) =>
	"rounded-md px-[15px] py-[7px] text-[13px] " +
	(ready
		? "cursor-pointer border-0 bg-accent font-semibold text-accent-ink"
		: "cursor-not-allowed border border-line bg-raised text-faint");

export const INPUT =
	"w-full rounded-sm border border-edge bg-bg px-2.5 py-1.5 text-[13px] text-ink";
export const INPUT_SM =
	"w-full rounded-sm border border-edge bg-bg px-2.5 py-1.5 text-[12.5px] text-ink";
