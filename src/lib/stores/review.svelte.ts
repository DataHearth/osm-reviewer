import { page } from "$app/state";
import { post } from "$lib/post";
import type { AreaDraft } from "$lib/schemas/area";
import type { SourceDraft } from "$lib/schemas/source";
import type { Area, Candidate, Decision, Rel, Source, Staged } from "$lib/types";

/** Which form a rail opened. The fields themselves live in the form's own store. */
export interface DraftMark {
	editId: string | null;
}

/** Tags start selected unless they are unevidenced, invalid, or under conflict. */
const freshSel = (c: Candidate) => c.tags.map((t) => !!t.ev && !t.invalid && !c.conflict);

const NO_COUNTS = { pending: 0, staged: 0, total: 0 };

/**
 * The review session as the browser holds it: which candidate is open, what is
 * selected, which sheet is up, and where a slider has been dragged to but not
 * yet let go. Everything else is read straight off the load's data, so a render
 * on the server sees the same rows a render in the browser does, and a decision
 * is never drawn as taken before the server has taken it.
 */
class ReviewState {
	idx = $state(0);
	qIdx = $state(0);
	sel = $state<Record<string, boolean[]>>({});
	last = $state<{ kind: "accept" | "reject"; id: string; name: string } | null>(null);

	typeFilter = $state<"all" | Candidate["type"]>("all");
	confFilter = $state<"all" | "high" | "mid" | "low">("all");
	sortKey = $state("type");
	sortDir = $state<"asc" | "desc">("asc");
	/** The queue's own escape hatch out of the empty screen. */
	emptyDismissed = $state(false);

	upload = $state<"idle" | "failed" | "retry" | "sent">("idle");
	uploadConflict = $state<{
		candidateId: string;
		osmId: string;
		changesetId: string;
		baseVersion: number;
		headVersion: number;
		staged: number;
	} | null>(null);

	srcId = $state<string | null>(null);
	areaId = $state<string | null>(null);
	srcDraft = $state<DraftMark | null>(null);
	draft = $state<DraftMark | null>(null);
	areaCard = $state<{ id: string; x: number; top: number } | null>(null);

	/** Sources whose rejected API key has been replaced in this session. */
	fixed = $state<Record<string, boolean>>({});
	started = $state<Record<string, boolean>>({});

	// A range input fires while it is being dragged and again when it is let go.
	// Only the release writes, so the value in between lives here.
	private floorDrag = $state<Record<string, number>>({});
	private radiusDrag = $state<Record<string, number>>({});

	/** A candidate another screen asked for, opened once the review load carries it. */
	private wanted = $state<string | null>(null);

	/** The review screen owns the accept/reject forms; the keymap reaches them through here. */
	submitAccept: ((id: string, tags: number[]) => void) | null = null;
	submitReject: ((id: string) => void) | null = null;
	submitUpload: (() => void) | null = null;

	// ── what the load carried ───────────────────────────────────────────────
	get candidates(): Candidate[] {
		return page.data.candidates ?? [];
	}

	get sources(): Source[] {
		return page.data.sources ?? [];
	}

	get areas(): Area[] {
		return page.data.areas ?? [];
	}

	get rels(): Rel[] {
		return page.data.rels ?? [];
	}

	get staged(): Staged[] {
		return page.data.staged ?? [];
	}

	get decided(): Record<string, Decision> {
		return page.data.decided ?? {};
	}

	private get counts(): { pending: number; staged: number; total: number } {
		return page.data.counts ?? NO_COUNTS;
	}

	get total() {
		return this.counts.total;
	}

	get pendingCount() {
		return this.counts.pending;
	}

	get stagedCount() {
		return this.counts.staged;
	}

	get empty() {
		return this.counts.pending === 0 && !this.emptyDismissed;
	}

	get links(): Record<string, boolean> {
		const m: Record<string, boolean> = {};
		for (const a of this.areas)
			for (const s of this.sources) m[s.id + ":" + a.id] = a.sources.includes(s.id);
		return m;
	}

	get enabled(): Record<string, boolean> {
		return Object.fromEntries(this.sources.map((s) => [s.id, s.enabled || !!this.fixed[s.id]]));
	}

	get floors(): Record<string, number> {
		return Object.fromEntries(this.sources.map((s) => [s.id, this.floorDrag[s.id] ?? s.floor]));
	}

	get radii(): Record<string, number> {
		return Object.fromEntries(
			this.areas.filter((a) => a.radius !== undefined).map((a) => [a.id, this.radiusOf(a)]),
		);
	}

	get paused(): Record<string, boolean> {
		return Object.fromEntries(this.areas.map((a) => [a.id, a.status === "paused"]));
	}

	get visibleAreas() {
		return this.areas;
	}

	// ── derived ─────────────────────────────────────────────────────────────
	get candidate(): Candidate | undefined {
		const list = this.candidates;
		if (this.wanted) {
			const found = list.find((c) => c.id === this.wanted);
			if (found) return found;
		}
		return list[this.idx] ?? list[0];
	}

	get position() {
		return this.idx + 1 + " / " + this.total;
	}

	get selected() {
		const c = this.candidate;
		if (!c) return [];
		return this.sel[c.id] ?? freshSel(c);
	}

	get selCount() {
		return this.selected.filter(Boolean).length;
	}

	get visible() {
		let r = this.candidates.filter((c) => !this.decided[c.id]);
		if (this.typeFilter !== "all") r = r.filter((c) => c.type === this.typeFilter);
		if (this.confFilter === "high") r = r.filter((c) => c.conf >= 0.85);
		if (this.confFilter === "mid") r = r.filter((c) => c.conf >= 0.6 && c.conf < 0.85);
		if (this.confFilter === "low") r = r.filter((c) => c.conf < 0.6);
		const dir = this.sortDir === "asc" ? 1 : -1;
		return r.slice().sort((a, b) => {
			const x = this.sortValue(a, this.sortKey);
			const y = this.sortValue(b, this.sortKey);
			if (x !== y) return (x < y ? -1 : 1) * dir;
			return b.conf - a.conf;
		});
	}

	get blockedReason(): string | null {
		const c = this.candidate;
		if (!c) return null;
		if (c.conflict)
			return (
				"accept blocked — version conflict unresolved. Rebase onto v" +
				c.headVersion +
				" or drop the candidate."
			);
		if (c.allQuarantined)
			return "accept blocked — candidate quarantined, no tag has evidence. Reject, or requeue for re-extraction.";
		const sel = this.selected;
		if (c.tags.some((t, i) => t.invalid && sel[i]))
			return "accept blocked — opening_hours fails syntax validation. Deselect the tag to accept the rest.";
		if (!sel.some(Boolean)) return "nothing selected — no tags would be written.";
		return null;
	}

	get checks() {
		const c = this.candidate;
		if (!c) return [];
		return [
			{ label: "opening_hours syntax", ok: !c.hasInvalid },
			{ label: "version current (v" + c.version + ")", ok: !c.conflict },
			{
				label: c.hasNoEv
					? c.tags.filter((t) => !t.ev).length + " tag(s) unevidenced"
					: "all tags evidenced",
				ok: !c.hasNoEv,
			},
			{ label: "source freshness", ok: !c.stale },
		];
	}

	sortValue(c: Candidate, k: string): string | number {
		if (k === "type") return c.type === "new" ? 0 : c.type === "closure" ? 1 : 2;
		if (k === "name") return c.name.toLowerCase();
		if (k === "tags") return c.tags.length;
		if (k === "source") return c.source;
		if (k === "age") return parseInt(c.age, 10) || 0;
		if (k === "flags")
			return c.conflict
				? 5
				: c.hasInvalid
					? 4
					: c.allQuarantined
						? 3
						: c.hasNoEv
							? 2
							: c.stale
								? 1
								: 0;
		return c.conf;
	}

	source(id: string | null) {
		return this.sources.find((s) => s.id === id) ?? this.sources[0];
	}

	area(id: string | null) {
		const list = this.visibleAreas;
		return list.find((a) => a.id === id) ?? list[0];
	}

	yieldFor(srcId: string, areaId: string): [number, number] | undefined {
		return page.data.yields?.[srcId + ":" + areaId];
	}

	/** Sources both linked to this area and globally enabled. */
	sourceCount(a: Area) {
		const links = this.links;
		const enabled = this.enabled;
		return this.sources.filter((s) => links[s.id + ":" + a.id] && enabled[s.id]).length;
	}

	radiusOf(a: Area) {
		return this.radiusDrag[a.id] ?? a.radius ?? 2500;
	}

	sqkmOf(a: Area) {
		return a.def === "radius" ? (Math.PI * this.radiusOf(a) ** 2) / 1e6 : a.sqkm;
	}

	metric(s: Source, label: string) {
		return s.metrics.find((m) => m[0] === label) ?? ["", "—", "", null];
	}

	configValue(s: Source, label: string) {
		const r = s.config.find((x) => x[0] === label);
		return r ? String(r[1]) : "";
	}

	// ── review ──────────────────────────────────────────────────────────────
	sortBy(key: string) {
		if (this.sortKey === key) this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
		else this.sortDir = key === "type" || key === "name" || key === "source" ? "asc" : "desc";
		this.sortKey = key;
		this.qIdx = 0;
	}

	open(c: Candidate, i = this.qIdx) {
		this.wanted = null;
		this.idx = this.candidates.indexOf(c);
		this.qIdx = i;
	}

	openCandidate(id: string) {
		const i = this.candidates.findIndex((c) => c.id === id);
		if (i >= 0) {
			this.wanted = null;
			this.idx = i;
		} else {
			this.wanted = id;
		}
	}

	move(d: number) {
		const n = this.candidates.length;
		if (!n) return;
		this.wanted = null;
		this.idx = (this.idx + d + n) % n;
	}

	toggle(i: number) {
		const c = this.candidate;
		if (!c?.tags[i]) return;
		const row = this.selected.slice();
		row[i] = !row[i];
		this.sel = { ...this.sel, [c.id]: row };
	}

	accept() {
		if (this.blockedReason) return;
		const c = this.candidate;
		if (!c) return;
		this.submitAccept?.(
			c.id,
			this.selected.flatMap((on, i) => (on ? [i] : [])),
		);
	}

	reject() {
		const c = this.candidate;
		if (!c || this.decided[c.id]) return;
		this.submitReject?.(c.id);
	}

	/** What a decision the server has already taken does to the session. */
	settled(id: string, kind: "accept" | "reject") {
		const i = this.candidates.findIndex((x) => x.id === id);
		const c = this.candidates[i];
		if (!c) return;
		this.last = { kind, id, name: c.name };
		this.wanted = null;
		this.idx = (i + 1) % this.candidates.length;
	}

	async undo() {
		const l = this.last;
		if (!l) return;
		this.last = null;
		const r = await post("/review?/undo", { id: l.id });
		if (r.ok) this.openCandidate(l.id);
	}

	async rebase() {
		const c = this.candidate;
		if (c) await post("?/rebase", { id: c.id });
	}

	async unstage(id: string) {
		await post("/review?/undo", { id });
	}

	doUpload() {
		if (!this.staged.length) return;
		this.submitUpload?.();
	}

	retryUpload() {
		this.upload = "retry";
		this.doUpload();
	}

	dismissEmpty() {
		this.emptyDismissed = true;
	}

	// ── sources & areas ─────────────────────────────────────────────────────
	async toggleLink(srcId: string, areaId: string) {
		await post("?/link", { sourceId: srcId, areaId, on: !this.links[srcId + ":" + areaId] });
	}

	setFloor(srcId: string, v: number) {
		this.floorDrag = { ...this.floorDrag, [srcId]: v };
	}

	async saveFloor(srcId: string) {
		const v = this.floorDrag[srcId];
		if (v === undefined) return;
		await post("?/floor", { id: srcId, floor: v });
		const { [srcId]: _saved, ...rest } = this.floorDrag;
		this.floorDrag = rest;
	}

	runNow(srcId: string) {
		this.started = { ...this.started, [srcId]: true };
	}

	/** Replacing a rejected key is what "run now" and "enable" mean on a failing source. */
	async repair(srcId: string) {
		this.fixed = { ...this.fixed, [srcId]: true };
		await post("?/enabled", { id: srcId, enabled: true });
	}

	async toggleEnabled(s: Source) {
		if (s.failing && !this.fixed[s.id] && !this.enabled[s.id]) return this.repair(s.id);
		await post("?/enabled", { id: s.id, enabled: !this.enabled[s.id] });
	}

	async togglePaused(a: Area) {
		await post("?/paused", { id: a.id, paused: a.status !== "paused" });
	}

	setRadius(a: Area, v: number) {
		this.radiusDrag = { ...this.radiusDrag, [a.id]: v };
	}

	async saveRadius(a: Area) {
		const v = this.radiusDrag[a.id];
		if (v === undefined) return;
		await post("?/radius", { id: a.id, radius: v });
		const { [a.id]: _saved, ...rest } = this.radiusDrag;
		this.radiusDrag = rest;
	}

	async removeArea(a: Area) {
		this.areaId = this.areas.find((x) => x.id !== a.id)?.id ?? null;
		await post("?/remove", { id: a.id });
	}

	// ── drafts ──────────────────────────────────────────────────────────────
	newSource() {
		this.srcDraft = { editId: null };
	}

	editSource(s: Source) {
		this.srcDraft = { editId: s.id };
	}

	newArea() {
		this.draft = { editId: null };
	}

	editArea(a: Area) {
		this.draft = { editId: a.id };
	}

	/** The values a freshly opened source form starts from. */
	sourceDraftFor(editId: string | null): SourceDraft {
		const blank: SourceDraft = {
			editId: null,
			name: "",
			kind: "api",
			endpoint: "",
			fileSize: "",
			key: "",
			schedule: "weekly",
			floor: 0.6,
			allow: ["opening_hours", "phone", "website"],
			matching: "SIRET ↔ ref:FR:SIRET, then name + addr fuzzy ≥0.88",
			budget: "400 pages / run · 1 request / 4 s per host",
			extractor: "deterministic",
			areas: Object.fromEntries(this.visibleAreas.map((a, i) => [a.id, i === 0])),
		};
		const s = editId ? this.sources.find((x) => x.id === editId) : null;
		if (!s) return blank;

		const cfg = (label: string) => this.configValue(s, label);
		const endpointLabel =
			s.kind === "registry" ? "dataset" : s.kind === "crawl" ? "seed rule" : "endpoint";
		const links = this.links;
		return {
			editId: s.id,
			name: s.name,
			kind: s.kind,
			endpoint: cfg(endpointLabel).split(" · ")[0],
			fileSize: "",
			key: "",
			schedule:
				(["every 12 h", "daily", "weekly", "monthly"] as const).find(
					(x) => x === cfg("schedule").split(" · ")[0],
				) ?? "weekly",
			floor: this.floors[s.id] ?? s.floor,
			allow: s.allow.slice(),
			matching: cfg("matching") || blank.matching,
			budget: cfg("budget") || blank.budget,
			extractor: /qwen|instruct|model/.test(cfg("extractor")) ? "model" : "deterministic",
			areas: Object.fromEntries(this.visibleAreas.map((a) => [a.id, !!links[s.id + ":" + a.id]])),
		};
	}

	/** The values a freshly opened area form starts from. */
	areaDraftFor(editId: string | null): AreaDraft {
		const blank: AreaDraft = {
			editId: null,
			name: "",
			mode: "relation",
			query: this.rels[0]?.name ?? "",
			picked: null,
			extraRels: [],
			center: [43.6045, 1.444],
			radius: 2500,
			srcs: Object.fromEntries(this.sources.map((s) => [s.id, s.enabled])),
		};
		const a = editId ? this.areas.find((x) => x.id === editId) : null;
		if (!a) return blank;

		const cur =
			a.def === "relation" && a.rel
				? {
						name: a.name,
						rel: a.rel,
						meta: "admin_level=" + a.level + " · current boundary · " + a.sqkm + " km²",
						center: a.center,
						km: a.km ?? 0,
						sqkm: a.sqkm,
						pois: a.pois,
						est: "—",
					}
				: null;
		const links = this.links;
		return {
			editId: a.id,
			name: a.name,
			mode: a.def,
			query: cur ? cur.name : "",
			picked: cur,
			extraRels: cur ? [cur] : [],
			center: a.center,
			radius: this.radiusOf(a),
			srcs: Object.fromEntries(this.sources.map((s) => [s.id, !!links[s.id + ":" + a.id]])),
		};
	}
}

export const review = new ReviewState();
