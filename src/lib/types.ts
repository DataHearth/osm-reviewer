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
	osmId: string;
	type: CandidateType;
	name: string;
	addr: string;
	lat: number;
	lon: number;
	source: string;
	conf: number;
	version: number;
	fetched: string;
	age: string;
	stale?: number;
	conflict?: boolean;
	baseVersion?: number;
	headVersion?: number;
	conflictWho?: string;
	theirs?: { k: string; v: string }[];
	ours?: { k: string; v: string }[];
	nearby: string[];
	unchanged: string;
	tags: Tag[];
	/** Derived once at load: no tag has evidence, so nothing can be accepted. */
	allQuarantined: boolean;
	hasNoEv: boolean;
	hasInvalid: boolean;
}

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

export interface Source {
	id: string;
	name: string;
	kind: SourceKind;
	kindLabel: string;
	health: "ok" | "warn" | "error";
	failing?: boolean;
	enabled: boolean;
	floor: number;
	allow: string[];
	config: ConfigRow[];
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
	sqkm: number;
	pending: number;
	pois: string;
	accepted30: number;
	status: string;
	lastRun: string;
	sources: string[];
}

/** An OSM admin relation offered by the area picker. */
export interface Rel {
	name: string;
	rel: string;
	meta: string;
	center: [number, number];
	km: number;
	sqkm: number;
	pois: string;
	est: string;
}

/** An accepted candidate waiting for an upload, with the tags the accept selected. */
export interface Staged {
	id: string;
	osmId: string;
	name: string;
	type: CandidateType;
	tags: Tag[];
}

export type Decision = "accepted" | "rejected";

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
	/** Fixture only — the prototype validates in the browser, never over a wire. */
	password?: string;
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

/** [action, keys, what it does] — the keymap +layout.svelte implements. */
export type KeyRow = [string, string, string];

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
