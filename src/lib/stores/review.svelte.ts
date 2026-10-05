import { goto, invalidateAll } from "$app/navigation";
import { page } from "$app/state";
import { post } from "$lib/post";
import type { AreaDraft } from "$lib/schemas/area";
import {
	DEFAULT_QUERY,
	defaultDir,
	type QueueQuery,
	queueHref,
	queueSearch,
	type SortKey,
} from "$lib/schemas/queue";
import type { SourceDraft } from "$lib/schemas/source";
import type { Area, Candidate, Counts, ScopeArea, Source } from "$lib/types";

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

/** A reviewer's changes to one candidate, held until it is accepted. */
export interface Edits {
	/** Proposal position → the value typed over it. */
	vals: Record<number, string>;
	/** A key the object already has → its new value, or null to delete it. */
	existing: Record<string, string | null>;
	added: { k: string; v: string }[];
	/** Proposal positions the reviewer deleted: never selected, never written. */
	dropped: number[];
}

const NO_EDITS: Edits = { vals: {}, existing: {}, added: [], dropped: [] };

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
	edits = $state<Record<string, Edits>>({});
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

	/** A candidate another screen asked for, opened once the review load carries it. */
	private wanted = $state<string | null>(null);

	/** The review screen owns the accept/reject forms; the keymap reaches them through here. */
	submitAccept: (() => void) | null = null;
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
			for (const s of this.sources) m[`${s.id}:${a.id}`] = a.sources.includes(s.id);
		return m;
	}

	get enabled(): Record<string, boolean> {
		return Object.fromEntries(this.sources.map((s) => [s.id, s.enabled]));
	}

	get radii(): Record<string, number> {
		return Object.fromEntries(
			this.areas.filter((a) => a.radius !== undefined).map((a) => [a.id, this.radiusOf(a)]),
		);
	}

	get paused(): Record<string, boolean> {
		return Object.fromEntries(this.areas.map((a) => [a.id, a.status === "disabled"]));
	}

	// ── derived ─────────────────────────────────────────────────────────────
	get candidate(): Candidate | undefined {
		const list = this.candidates;
		if (this.wanted) {
			const linked: Candidate | null = page.data.linked ?? null;
			const found =
				list.find((c) => c.id === this.wanted) ?? (linked?.id === this.wanted ? linked : null);
			if (found) return found;
		}
		return list[this.idx] ?? list[0];
	}

	get position() {
		const c = this.candidate;
		return `${this.offset + (c ? this.candidates.indexOf(c) : 0) + 1} / ${this.matching}`;
	}

	get selected() {
		const c = this.candidate;
		if (!c) return [];
		const dropped = this.edit.dropped;
		return (this.sel[c.id] ?? freshSel(c)).map((on, i) => on && !dropped.includes(i));
	}

	get edit(): Edits {
		const c = this.candidate;
		return (c && this.edits[c.id]) || NO_EDITS;
	}

	/**
	 * What the accept form posts: proposals taken as they are by position, everything
	 * the reviewer typed as `key=value`, and the keys they removed. Whether a write adds
	 * or modifies is the server's call, made against the object's tags.
	 */
	get picks(): { tags: number[]; set: string[]; del: string[] } {
		const c = this.candidate;
		const out = { tags: [] as number[], set: [] as string[], del: [] as string[] };
		if (!c) return out;
		const e = this.edit;
		const sel = this.selected;
		c.tags.forEach((t, i) => {
			if (!sel[i]) return;
			if (i in e.vals) out.set.push(`${t.k}=${e.vals[i]}`);
			else out.tags.push(i);
		});
		for (const [k, v] of Object.entries(e.existing)) {
			if (v === null) out.del.push(k);
			else out.set.push(`${k}=${v}`);
		}
		for (const a of e.added) if (a.k.trim()) out.set.push(`${a.k.trim()}=${a.v}`);
		return out;
	}

	get selCount() {
		const p = this.picks;
		return p.tags.length + p.set.length + p.del.length;
	}

	get blockedReason(): string | null {
		const c = this.candidate;
		if (!c) return null;
		if (c.decided) return `accept blocked — already ${c.decided.kind} by ${c.decided.by}.`;
		if (c.conflict)
			return (
				"accept blocked — version conflict unresolved. Rebase onto v" +
				c.headVersion +
				" or drop the candidate."
			);
		if (c.allQuarantined)
			return "accept blocked — candidate quarantined, no tag has evidence. Reject, or requeue for re-extraction.";
		const sel = this.selected;
		const e = this.edit;
		const typed = (i: number) => i in e.vals;
		const bad = c.tags.find((t, i) => t.invalid && sel[i] && !typed(i));
		if (bad)
			return `accept blocked — ${bad.k} fails validation. Fix the value or deselect the tag.`;
		if (c.tags.some((t, i) => !t.ev && sel[i] && !typed(i)))
			return "accept blocked — an unevidenced tag cannot be written. Type its value to vouch for it, or deselect it.";
		const empty = [
			...c.tags.filter((_, i) => sel[i] && typed(i) && !e.vals[i].trim()).map((t) => t.k),
			...Object.entries(e.existing).flatMap(([k, v]) => (v !== null && !v.trim() ? [k] : [])),
			...e.added.filter((a) => a.k.trim() && !a.v.trim()).map((a) => a.k.trim()),
		];
		if (empty.length) return `${empty[0]} needs a value.`;
		if (!this.selCount) return "nothing selected — no tags would be written.";
		return null;
	}

	get checks() {
		const c = this.candidate;
		if (!c) return [];
		return [
			{ label: "opening_hours syntax", ok: !c.hasInvalid },
			{ label: `version current (v${c.version})`, ok: !c.conflict },
			{
				label: c.hasNoEv
					? `${c.tags.filter((t) => !t.ev).length} tag(s) unevidenced`
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
		const list = this.areas;
		return list.find((a) => a.id === id) ?? list[0];
	}

	yieldFor(srcId: string, areaId: string): [number, number | null] | undefined {
		return page.data.yields?.[`${srcId}:${areaId}`];
	}

	/** Sources both linked to this area and globally enabled. */
	sourceCount(a: Area) {
		const links = this.links;
		const enabled = this.enabled;
		return this.sources.filter((s) => links[`${s.id}:${a.id}`] && enabled[s.id]).length;
	}

	radiusOf(a: Area) {
		return a.radius ?? 2500;
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

	/** `/review` on one candidate, inside the queue's view. */
	reviewHref(id: string) {
		const q = new URLSearchParams(queueSearch(this.query));
		q.set("id", id);
		return `/review?${q}`;
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

	/** Moves the queue selection a row, onto the next or previous page past either end. */
	async step(d: 1 | -1) {
		const next = this.qIdx + d;
		if (next >= 0 && next < this.candidates.length) this.qIdx = next;
		else if (await this.turnPage(d)) this.qIdx = d > 0 ? 0 : this.candidates.length - 1;
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
		if (!c?.tags[i] || this.edit.dropped.includes(i)) return;
		const row = this.selected.slice();
		row[i] = !row[i];
		this.sel = { ...this.sel, [c.id]: row };
	}

	dropTag(i: number) {
		this.patch((e) => ({ ...e, dropped: [...e.dropped, i] }));
	}

	/** Back as it was proposed: selected the way a fresh candidate would have it. */
	restoreTag(i: number) {
		const c = this.candidate;
		if (!c) return;
		this.patch((e) => ({ ...e, dropped: e.dropped.filter((j) => j !== i) }));
		this.sel = { ...this.sel, [c.id]: this.selected.with(i, freshSel(c)[i]) };
	}

	private patch(fn: (e: Edits) => Edits) {
		const c = this.candidate;
		if (c) this.edits = { ...this.edits, [c.id]: fn(this.edit) };
	}

	/** Typing over a proposal selects it: the value on screen is the one that would be written. */
	editValue(i: number, v: string) {
		const tag = this.candidate?.tags[i];
		if (!tag) return;
		this.patch((e) => {
			const vals = { ...e.vals };
			if (v === tag.v) delete vals[i];
			else vals[i] = v;
			return { ...e, vals };
		});
		if (!this.selected[i]) this.toggle(i);
	}

	/** `null` deletes the key; its original value puts it back untouched. */
	editExisting(k: string, v: string | null) {
		const was = this.candidate?.unchanged.find((x) => x.k === k)?.v;
		this.patch((e) => {
			const existing = { ...e.existing };
			if (v === was) delete existing[k];
			else existing[k] = v;
			return { ...e, existing };
		});
	}

	addTag() {
		this.patch((e) => ({ ...e, added: [...e.added, { k: "", v: "" }] }));
	}

	editAdded(i: number, tag: { k: string; v: string } | null) {
		this.patch((e) => ({
			...e,
			added: tag ? e.added.with(i, tag) : e.added.filter((_, j) => j !== i),
		}));
	}

	accept() {
		if (this.blockedReason) return;
		this.submitAccept?.();
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
		if (!this.stagedCount) return;
		this.submitUpload?.();
	}

	retryUpload() {
		this.upload = "retry";
		this.doUpload();
	}

	// ── sources & areas ─────────────────────────────────────────────────────
	async toggleEnabled(s: Source) {
		await post("?/enabled", { id: s.id, enabled: !this.enabled[s.id] });
	}

	runNow(s: Source) {
		return post("?/runNow", { id: s.id });
	}

	runPipeline(a: Area) {
		return post("?/runArea", { id: a.id });
	}

	/** Any of these sources asked for or mid-run. */
	running(ids: string[]) {
		return this.sources.some((s) => s.running && ids.includes(s.id));
	}

	async togglePaused(a: Area) {
		await post("?/paused", { id: a.id, paused: a.status !== "disabled" });
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
			areas: Object.fromEntries(this.areas.map((a, i) => [a.id, i === 0])),
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
			floor: s.floor,
			allow: s.allow.slice(),
			matching: s.matching,
			budget: s.budget,
			extractor: s.extractor,
			areas: Object.fromEntries(this.areas.map((a) => [a.id, !!links[`${s.id}:${a.id}`]])),
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
			srcs: Object.fromEntries(this.sources.map((s) => [s.id, !!links[`${s.id}:${a.id}`]])),
		};
	}
}

export const review = new ReviewState();
