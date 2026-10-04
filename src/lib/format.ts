import type { Candidate, TagOp, Tone } from "./types";

export const comma = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Read a display number back out of a formatted fixture string ("18,402"). */
export const num = (v: string | number) => {
	const n = parseFloat(String(v).replace(/[, ]/g, ""));
	return Number.isNaN(n) ? 0 : n;
};

export const confTone = (v: number): Tone => (v >= 0.85 ? "ok" : v >= 0.6 ? "warn" : "bad");
export const confText = (v: number) =>
	v >= 0.85 ? "text-ok" : v >= 0.6 ? "text-warn" : "text-bad";
export const pct = (v: number) => `${Math.floor(v * 100)}%`;
export const confBg = (v: number) => (v >= 0.85 ? "bg-ok" : v >= 0.6 ? "bg-warn" : "bg-bad");

export const toneText = (t: Tone | undefined) =>
	t === "ok" ? "text-ok" : t === "warn" ? "text-warn" : t === "bad" ? "text-bad" : "text-ink";

export const healthTone = (h: "ok" | "warn" | "error"): Tone =>
	h === "ok" ? "ok" : h === "warn" ? "warn" : "bad";
export const toneDot = (t: Tone) =>
	t === "ok" ? "bg-ok" : t === "warn" ? "bg-warn" : t === "bad" ? "bg-bad" : "bg-dim";

export const OP_SIGN: Record<TagOp, string> = { add: "+", mod: "~", del: "-" };
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

export const OP_LABEL: Record<TagOp, string> = { add: "+ add", mod: "~ modify", del: "- delete" };
export const OP_CHIP: Record<TagOp, string> = {
	add: "bg-add/15 text-ok-ink",
	mod: "bg-mod/15 text-mod",
	del: "bg-del/15 text-bad-ink",
};

export const typeLabel = (t: Candidate["type"]) =>
	t === "new" ? "New POI" : t === "closure" ? "Closure" : "Tag update";
export const typeSlug = (t: Candidate["type"]) =>
	t === "new" ? "new-poi" : t === "closure" ? "closure" : "tag-update";
export const typeText = (t: Candidate["type"]) =>
	t === "new" ? "text-ok-ink" : t === "closure" ? "text-bad-ink" : "text-muted";
/** The dot that leads a queue row: the type, readable before the name. */
export const typeDot = (t: Candidate["type"]) =>
	t === "new" ? "bg-ok" : t === "closure" ? "bg-bad" : "bg-key";

/** Status label: flags and banner tags. Outline or fill comes from the caller. */
export const CHIP =
	"inline-flex items-center rounded-md border px-2 text-[11.5px] font-medium leading-[20px] whitespace-nowrap";
export const FLAG_BAD = "border-bad/50 text-bad-ink";
export const FLAG_WARN = "border-warn/45 text-warn-ink";
/** A key named in a shortcut hint, and its variant inside the accent button. */
export const KBD = "font-mono text-[11px] font-normal text-ink-2";
export const KBD_ACCENT = "font-mono text-[11px] font-normal opacity-65";

export const statusText = (s: string) =>
	s === "active" ? "text-ok-ink" : s === "disabled" ? "text-warn" : "text-faint";
export const statusPill = (s: string) =>
	s === "active"
		? "bg-ok-bg text-ok-ink"
		: s === "disabled"
			? "bg-warn-bg text-warn"
			: "bg-raised text-muted";

/** No link for a candidate that has no OSM object yet. */
/** `base` is the instance's `OSM_URL`, so the link opens the map the upload writes to. */
export const osmUrl = (base: string, osmId: string | null) =>
	osmId === null ? undefined : `${base}/${osmId}`;

const pad = (n: number) => String(n).padStart(2, "0");

/** DD-MM-YYYY — the only date format the app displays. */
export const fmtDate = (d: Date) =>
	`${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

/** DD-MM-YYYY HH:MM, in the operator's own clock — every displayed instant. */
export const stamp = (d: Date) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const nowStamp = () => stamp(new Date());

/** "2 s", "41 min", "1 h 05 min": the longest unit that keeps one or two digits. */
export function fmtDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s} s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min`;
	return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

/** 392, "3,742", "34.2M". */
export function fmtCount(n: number): string {
	return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : comma(n);
}

/** Whole days since `then`, never negative. */
export const daysSince = (then: Date, now: Date = new Date()) =>
	Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));

/** A candidate fetched this long ago and still unreviewed is stale. */
export const STALE_AFTER_DAYS = 60;

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

/** A control for a feature with nothing behind it yet: visible, so the screen keeps its shape, but inert. */
export const INERT_BTN =
	"cursor-not-allowed rounded-sm border border-line bg-transparent px-[11px] py-1 text-[12px] whitespace-nowrap text-faint";

/** A bare word that acts on a row — reset, delete, restore. */
export const TEXT_BTN =
	"shrink-0 cursor-pointer border-0 bg-transparent p-0 font-sans text-[11.5px] text-faint hover:text-ink";

/** A ‹ / › step of a pager, dimmed at the end it cannot step past. */
export const pageStep = (on: boolean) =>
	`${on ? ghost(false) : INERT_BTN} inline-flex items-center justify-center !px-2 !py-0 leading-[20px] max-md:min-h-[40px] max-md:min-w-[44px]`;

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
