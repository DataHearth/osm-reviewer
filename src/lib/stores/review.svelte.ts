import { goto, invalidateAll } from "$app/navigation";
import { page } from "$app/state";
import { post } from "$lib/post";
import type { AreaDraft } from "$lib/schemas/area";
import {
	DEFAULT_QUERY,
	defaultDir,
	type QueueQuery,
	queueHref,
	type SortKey,
} from "$lib/schemas/queue";
import type { SourceDraft } from "$lib/schemas/source";
import type { Area, Candidate, Counts, ScopeArea, Source, Staged } from "$lib/types";

/** Which form a rail opened. The fields themselves live in the form's own store. */
export interface DraftMark {
	editId: string | null;
}

export interface Sending {
	id: string;
	name: string;
	/** Where on the loaded page it sat. */
	index: number;
}

/** Tags start selected unless they are unevidenced, invalid, or under conflict. */
const freshSel = (c: Candidate) => c.tags.map((t) => !!t.ev && !t.invalid && !c.conflict);

const NO_COUNTS: Counts = { pending: 0, staged: 0, total: 0, scope: null, areas: [] };

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

	/** Phone filter sheet. Its trigger lives in the title bar, the sheet on the queue. */
	filterSheet = $state(false);

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

	get staged(): Staged[] {
		return page.data.staged ?? [];
	}

	/** The queue's view: filters, sort and page, as the URL carries them. */
	get query(): QueueQuery {
		return page.data.query ?? DEFAULT_QUERY;
	}

	get typeFilter() {
		return this.query.type;
	}

	set typeFilter(type: QueueQuery["type"]) {
		this.view({ type });
	}

	get confFilter() {
		return this.query.conf;
	}

	set confFilter(conf: QueueQuery["conf"]) {
		this.view({ conf });
	}

	get sortKey() {
		return this.query.sort;
	}

	get sortDir() {
		return this.query.dir;
	}

	get pageNo() {
		return this.query.page;
	}

	get pages(): number {
		return page.data.pages ?? 1;
	}

	/** Every pending candidate the view's filters let through, on any page. */
	get matching(): number {
		return page.data.total ?? 0;
	}

	/** How many matching candidates sort before the loaded page. */
	get offset(): number {
		return page.data.offset ?? 0;
	}

	private get counts(): Counts {
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

	/** The area the session reviews; null reviews every area at once. */
	get scope() {
		return this.counts.scope;
	}

	get scopeAreas(): ScopeArea[] {
		return this.counts.areas;
	}

	get scopeArea() {
		return this.scopeAreas.find((a) => a.id === this.scope) ?? null;
	}

	get activeFilters() {
		return (this.typeFilter !== "all" ? 1 : 0) + (this.confFilter !== "all" ? 1 : 0);
	}

	get empty() {
		return this.counts.pending === 0;
	}

	get links(): Record<string, boolean> {
		const m: Record<string, boolean> = {};
		for (const a of this.areas)
			for (const s of this.sources) m[s.id + ":" + a.id] = a.sources.includes(s.id);
		return m;
	}

	get enabled(): Record<string, boolean> {
		return Object.fromEntries(this.sources.map((s) => [s.id, s.enabled]));
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
		const c = this.candidate;
		return this.offset + (c ? this.candidates.indexOf(c) : 0) + 1 + " / " + this.matching;
	}

	get selected() {
		const c = this.candidate;
		if (!c) return [];
		return this.sel[c.id] ?? freshSel(c);
	}

	get selCount() {
		return this.selected.filter(Boolean).length;
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

	source(id: string | null) {
		return this.sources.find((s) => s.id === id) ?? this.sources[0];
	}

	area(id: string | null) {
		const list = this.visibleAreas;
		return list.find((a) => a.id === id) ?? list[0];
	}

	yieldFor(srcId: string, areaId: string): [number, number | null] | undefined {
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

	// ── review ──────────────────────────────────────────────────────────────
	/**
	 * The scope is view state, not data, so it rides in a cookie rather than a form
	 * action: every load reads it, and nothing about it needs validating beyond the
	 * load falling back when it names no area.
	 */
	async setScope(id: string | null) {
		// biome-ignore lint/suspicious/noDocumentCookie: a plain view preference the server reads back
		document.cookie = `scope=${id ?? "all"}; path=/; max-age=31536000; samesite=lax`;
		this.qIdx = 0;
		this.idx = 0;
		await invalidateAll();
	}

	/** `path` carrying the queue's view, with `change` applied to it. */
	href(path: string, change: Partial<QueueQuery> = {}) {
		return queueHref(path, { ...this.query, ...change });
	}

	/**
	 * Shows another view of the queue. Each is a history entry of its own, so back and
	 * forward step through them; any change but paging starts again from page 1.
	 */
	private view(change: Partial<QueueQuery>) {
		this.qIdx = 0;
		return goto(this.href(page.url.pathname, { page: 1, ...change }), {
			keepFocus: true,
			noScroll: true,
		});
	}

	sortBy(key: SortKey) {
		const dir = this.sortKey !== key ? defaultDir(key) : this.sortDir === "asc" ? "desc" : "asc";
		this.view({ sort: key, dir });
	}

	/** False when there is no page that way. */
	async turnPage(d: 1 | -1) {
		const p = this.pageNo + d;
		if (p < 1 || p > this.pages) return false;
		await this.view({ page: p });
		return true;
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

	/**
	 * Steps through the loaded page, and past either end of it into the neighbouring
	 * page. Only a queue that fits on one page wraps around.
	 */
	async move(d: 1 | -1) {
		const list = this.candidates;
		const c = this.candidate;
		if (!c) return;
		this.wanted = null;
		const next = list.indexOf(c) + d;
		if (next >= 0 && next < list.length) this.idx = next;
		else if (this.pages === 1) this.idx = (next + list.length) % list.length;
		else if (await this.turnPage(d)) this.idx = d > 0 ? 0 : this.candidates.length - 1;
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
		if (!c) return;
		this.submitReject?.(c.id);
	}

	/**
	 * The open candidate as a decision on it is sent. It has to be taken then: by the
	 * time the decision settles, the reload has already dropped the candidate.
	 */
	sending(): Sending | null {
		const c = this.candidate;
		return c ? { id: c.id, name: c.name, index: this.candidates.indexOf(c) } : null;
	}

	/**
	 * What a decision the server has already taken does to the session. The decided
	 * candidate is gone from the reloaded page, so its index now holds the next one.
	 */
	settled(sent: Sending, kind: "accept" | "reject") {
		this.last = { kind, id: sent.id, name: sent.name };
		this.wanted = null;
		const i = Math.max(0, sent.index);
		this.idx = i < this.candidates.length ? i : 0;
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

	async toggleEnabled(s: Source) {
		await post("?/enabled", { id: s.id, enabled: !this.enabled[s.id] });
	}

	async runNow(s: Source) {
		await post("?/runNow", { id: s.id });
	}

	async runPipeline(a: Area) {
		await post("?/runArea", { id: a.id });
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
			key: "",
			schedule: "weekly",
			floor: 0.6,
			allow: ["opening_hours", "phone", "website"],
			matching: "",
			budget: "400 pages / run · 1 request / 4 s per host",
			extractor: "deterministic",
			areas: Object.fromEntries(this.visibleAreas.map((a, i) => [a.id, i === 0])),
		};
		const s = editId ? this.sources.find((x) => x.id === editId) : null;
		if (!s) return blank;

		const links = this.links;
		return {
			editId: s.id,
			name: s.name,
			kind: s.kind,
			endpoint: s.endpoint,
			key: "",
			schedule: s.schedule,
			floor: this.floors[s.id] ?? s.floor,
			allow: s.allow.slice(),
			matching: s.matching,
			budget: s.budget,
			extractor: s.extractor,
			areas: Object.fromEntries(this.visibleAreas.map((a) => [a.id, !!links[s.id + ":" + a.id]])),
		};
	}

	/** The values a freshly opened area form starts from. */
	areaDraftFor(editId: string | null): AreaDraft {
		const blank: AreaDraft = {
			editId: null,
			name: "",
			mode: "relation",
			query: "",
			picked: null,
			center: [43.6045, 1.444],
			radius: 2500,
			srcs: Object.fromEntries(this.sources.map((s) => [s.id, s.enabled])),
		};
		const a = editId ? this.areas.find((x) => x.id === editId) : null;
		if (!a) return blank;

		const cur =
			a.def === "relation" && a.rel
				? {
						rel: a.rel,
						name: a.name,
						displayName: a.displayName ?? a.name,
						level: a.level ?? null,
						center: a.center,
						bbox: a.bbox ?? null,
						km: a.km ?? 0,
						sqkm: a.sqkm,
					}
				: null;
		const links = this.links;
		return {
			editId: a.id,
			name: a.name,
			mode: a.def,
			query: cur ? cur.name : "",
			picked: cur,
			center: a.center,
			radius: this.radiusOf(a),
			srcs: Object.fromEntries(this.sources.map((s) => [s.id, !!links[s.id + ":" + a.id]])),
		};
	}
}

export const review = new ReviewState();
