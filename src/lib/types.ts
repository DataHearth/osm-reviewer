export type TagOp = "add" | "mod" | "del";
export type Tone = "ok" | "warn" | "bad" | null;

export interface EvidencePart {
	text: string;
	mark: boolean;
}

export interface Evidence {
	/** The source quote, split so the matched span can be marked. */
	parts: EvidencePart[];
	path: string;
	url: string;
	when: string;
	kind: string;
	conf: number;
}

export interface Tag {
	op: TagOp;
	k: string;
	v: string;
	was?: string;
	conf: number;
	ev: Evidence | null;
	invalid?: boolean;
	invalidMsg?: string;
	invalidHint?: string;
}

export type CandidateType = "new" | "update" | "closure";

export interface Candidate {
	id: string;
	/** What the run saw that the reviewer must check before trusting the match: a likely duplicate, a site split over several objects. */
	warnings?: string[];
	/** Only on a candidate opened by its link: someone already decided it. */
	decided?: { kind: "accepted" | "rejected"; by: string; at: string };
	osmId: string | null;
	type: CandidateType;
	name: string;
	addr: string;
	lat: number;
	lon: number;
	source: string;
	conf: number;
	version: number;
	fetched: string;
	/** Derived from the fetch time at load: "12d". */
	age: string;
	/** Days since the fetch, set only once it is past the staleness threshold. */
	stale?: number;
	conflict?: boolean;
	baseVersion?: number;
	headVersion?: number;
	conflictWho?: string;
	theirs?: { k: string; v: string }[];
	ours?: { k: string; v: string }[];
	nearby: string[];
	/** The object's tags no proposal touches, as OSM had them when the candidate was matched. */
	unchanged: { k: string; v: string }[];
	tags: Tag[];
	/** Derived once at load: no tag has evidence, so nothing can be accepted. */
	allQuarantined: boolean;
	hasNoEv: boolean;
	hasInvalid: boolean;
}

/** What a source said about one candidate, as read: the record's rows, or a crawled page's text. */
export type SourceRecord = { rows: Record<string, unknown>[] } | { text: string };

export type SourceKind = "registry" | "crawl" | "api";
export type ConfigRow = [string, string, ("code" | "warn" | "bad")?];
export type MetricRow = [string, string, string?, ("ok" | "warn" | "bad")?];

export interface Run {
	when: string;
	dur: string;
	fetched: string;
	cands: string;
	errors: string;
	result: string;
}

/** Which of a mapping's inputs each column of a source is, as the model stored it. */
export interface StoredColumns {
	/** DD-MM-YYYY HH:MM */
	madeAt: string;
	model: string;
	/** The columns it was made for; a read of exactly these columns reuses it. */
	columns: number;
	renamed: [column: string, input: string][];
	/** A column, the step of the shipped source that reads it, and the shipped column it stands for. */
	steps: [column: string, step: string, as: string][];
	ignored: [column: string, reason: string][];
}

/** The mapping a source's records go through, and how its columns reach the mapping's inputs. */
export interface ColumnMapping {
	/** `FR:school` */
	mapping: string;
	/** Null when the app no longer ships the mapping a stored renaming names. */
	title: string | null;
	/** Which renaming the last read went through; null before the first read. */
	origin: "shipped" | "stored" | null;
	/** The columns the app ships a renaming for; a read within them needs no model call. */
	shippedColumns: number;
	/** Null unless the last read went through a renaming the model made. */
	stored: StoredColumns | null;
	/** "Rename again" was asked and no run has honoured it yet. */
	renameRequested: boolean;
	/** Set where "rename again" cannot be asked: the button says why instead. */
	refusal: RenameRefusal | null;
}

export interface RenameRefusal {
	label: string;
	reason: string;
}

export interface Source {
	id: string;
	name: string;
	kind: SourceKind;
	kindLabel: string;
	health: "ok" | "warn" | "error";
	failing?: boolean;
	/** Asked for, or claimed by the runner right now. */
	running: boolean;
	enabled: boolean;
	floor: number;
	endpoint: string;
	schedule: "every 12 h" | "daily" | "weekly" | "monthly";
	matching: string;
	budget: string;
	extractor: "deterministic" | "model";
	licence: string;
	allow: string[];
	/** Null for a model extractor, and for a source no mapping is named for: its columns pick the preset at the first run. */
	columnMapping: ColumnMapping | null;
	/** Display rows, built from the columns and the last run at load. */
	config: ConfigRow[];
	/** Display rows, derived from runs, candidates and decisions at load. */
	metrics: MetricRow[];
	runs: Run[];
}

export interface Area {
	id: string;
	name: string;
	def: "relation" | "radius";
	rel?: string;
	level?: number;
	center: [number, number];
	km?: number;
	radius?: number;
	displayName?: string;
	bbox?: [number, number, number, number];
	sqkm: number;
	/** Derived at load from candidates and decisions. */
	pending: number;
	/** Formatted OSM POI count, "—" until a run has counted. */
	pois: string;
	accepted30: number;
	status: string;
	lastRun: string;
	sources: string[];
}

/** An area as the top bar's picker lists it, with what is still waiting in it. */
export interface ScopeArea {
	id: string;
	name: string;
	def: Area["def"];
	radius?: number;
	status: string;
	lastRun: string;
	sources: number;
	pending: number;
}

/** What the top bar and the phone nav show on every screen. `scope` null is every area. */
export interface Counts {
	pending: number;
	staged: number;
	total: number;
	scope: string | null;
	areas: ScopeArea[];
}

/** An OSM admin relation offered by the area picker. */
export interface Rel {
	rel: string;
	name: string;
	displayName: string;
	level: number | null;
	center: [number, number];
	bbox: [number, number, number, number] | null;
	km: number;
	sqkm: number;
}

/** An accepted candidate waiting for an upload, with the tags the accept selected. */
export interface Staged {
	id: string;
	osmId: string | null;
	name: string;
	type: CandidateType;
	source: string;
	tags: Pick<Tag, "op" | "k" | "v">[];
}

export interface Changeset {
	id: string;
	url: string;
	when: string;
	comment: string;
	objects: string;
	result: string;
}

// ── accounts & instance ───────────────────────────────────────────────────────
export type Role = "admin" | "reviewer";

export interface User {
	id: string;
	name: string;
	email: string;
	role: Role;
	initials: string;
	/** Provisioned through the identity provider: no local password to check. */
	ssoOnly?: boolean;
	osm?: string;
	lastSeen: string;
}

export interface Session {
	email: string;
	via: "password" | "sso";
	at: string;
}

/** The OSM identity every changeset is written under, once it is connected. */
export interface OsmIdentity {
	user: string;
	connected: string;
	scopes: string;
}

/** A row of the admin's users pane. */
export interface ManagedUser {
	id: string;
	name: string;
	email: string;
	role: Role;
	initials: string;
	password: boolean;
	sso: boolean;
	disabled: boolean;
	lastSeen: string;
	decisions: number;
}
