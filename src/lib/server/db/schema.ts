import { relations, sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { Bindings } from "../../keymap";

export const users = sqliteTable(
	"users",
	{
		id: text().primaryKey(),
		name: text().notNull(),
		email: text().notNull(),
		role: text({ enum: ["admin", "reviewer"] }).notNull(),
		initials: text().notNull(),
		/** Null for accounts the identity provider owns — `User.ssoOnly` is this being null. */
		passwordHash: text(),
		/** The identity provider's `sub`, set on the first SSO sign-in. Email can change there; this cannot. */
		ssoSubject: text(),
		/** Blocks every sign-in path but keeps the row, which decisions still point at. */
		disabled: integer({ mode: "boolean" }).notNull().default(false),
		lastSeen: integer({ mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("users_email_idx").on(t.email),
		uniqueIndex("users_sso_subject_idx").on(t.ssoSubject),
	],
);

export const sessions = sqliteTable(
	"sessions",
	{
		token: text().primaryKey(),
		userId: text()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		via: text({ enum: ["password", "sso"] }).notNull(),
		createdAt: integer({ mode: "timestamp" }).notNull(),
		expiresAt: integer({ mode: "timestamp" }).notNull(),
	},
	(t) => [index("sessions_user_idx").on(t.userId)],
);

export const sources = sqliteTable("sources", {
	id: text().primaryKey(),
	name: text().notNull(),
	kind: text({ enum: ["registry", "crawl", "api"] }).notNull(),
	/** What a run last reported about the source; `failing` is the held-after-failures state. */
	health: text({ enum: ["ok", "warn", "error"] }).notNull(),
	failing: integer({ mode: "boolean" }).notNull().default(false),
	/** Whether the pipeline polls it at all — orthogonal to `health`, which reports the last run. */
	enabled: integer({ mode: "boolean" }).notNull().default(true),
	floor: real().notNull(),
	/** registry: the dataset URL (a file, or a data.gouv.fr dataset API URL); api: the records URL; crawl: the seed rule. */
	endpoint: text().notNull().default(""),
	/** Sent to the endpoint as-is; the screens only ever show the last four characters. */
	apiKey: text(),
	schedule: text({ enum: ["every 12 h", "daily", "weekly", "monthly"] })
		.notNull()
		.default("weekly"),
	/** The OSM tag filter a source's records are matched against existing POIs by, e.g. `amenity=school`. */
	matching: text().notNull().default(""),
	/** Crawl only: the page and rate budget of one run, as the operator wrote it. */
	budget: text().notNull().default(""),
	extractor: text({ enum: ["deterministic", "model"] })
		.notNull()
		.default("deterministic"),
	/** The built-in field map a deterministic extractor applies; null until a run picks or the operator names one. */
	preset: text(),
	/** Free text, e.g. "Licence Ouverte 2.0". Shown on the source and written into changeset source tags. */
	licence: text().notNull().default(""),
	/** Null on an enabled source means due now. */
	nextRunAt: integer({ mode: "timestamp" }),
	/** "Run now": the scheduler runs the source at its next tick and clears this when the run starts. */
	runRequestedAt: integer({ mode: "timestamp" }),
	/** Set while a run is in flight, so a second tick or button press does not start another. */
	runningSince: integer({ mode: "timestamp" }),
	/** Opaque runner state between runs: ETag, snapshot hash, page cursor. Only the pipeline reads it. */
	syncState: text({ mode: "json" }).$type<Record<string, unknown>>(),
});

/**
 * One row per user, created with the account. Panes save independently, so every
 * column carries a default: an insert from one pane must not leave another's
 * fields null.
 */
export const userSettings = sqliteTable("user_settings", {
	userId: text()
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	osmConnected: integer({ mode: "timestamp" }),
	/**
	 * The OAuth2 access token, stored as-is: the database is the trust boundary, as it
	 * already is for `instanceSettings.webhookSecret` and `sessions.token`. Null until the
	 * account is connected, and again after it is disconnected.
	 */
	osmToken: text(),
	/** The account's OSM display name and numeric uid, read at connect time. */
	osmUserName: text(),
	osmUserId: integer(),
	osmScopes: text().notNull().default("write_api · read_prefs"),
	osmComment: text().notNull().default(""),
	osmSourceTag: text().notNull().default(""),
	osmHashtag: text().notNull().default("#poi-review"),
	osmPerChangeset: integer().notNull().default(50),
	vim: integer({ mode: "boolean" }).notNull().default(true),
	confirmAccept: integer({ mode: "boolean" }).notNull().default(false),
	showHints: integer({ mode: "boolean" }).notNull().default(true),
	bindings: text({ mode: "json" }).$type<Partial<Bindings>>().notNull().default({}),
});

/**
 * Settings that belong to the instance rather than to an account: the notification
 * channels. One row, pinned to id 1 by the check; reading creates it from the defaults.
 */
export const instanceSettings = sqliteTable(
	"instance_settings",
	{
		id: integer().primaryKey().default(1),
		ntfyOn: integer({ mode: "boolean" }).notNull().default(false),
		ntfyServer: text().notNull().default(""),
		ntfyTopic: text().notNull().default(""),
		webhookOn: integer({ mode: "boolean" }).notNull().default(false),
		webhookUrl: text().notNull().default(""),
		webhookSecret: text().notNull().default(""),
		emailOn: integer({ mode: "boolean" }).notNull().default(false),
		emailTo: text().notNull().default(""),
		emailRelay: text().notNull().default(""),
		queueOver: integer().notNull().default(250),
		eventQueue: integer({ mode: "boolean" }).notNull().default(true),
		eventSourceFailed: integer({ mode: "boolean" }).notNull().default(true),
		eventUploadFailed: integer({ mode: "boolean" }).notNull().default(true),
		eventRunFinished: integer({ mode: "boolean" }).notNull().default(false),
	},
	(t) => [check("instance_settings_single_row", sql`${t.id} = 1`)],
);

export const sourceAllowedTags = sqliteTable(
	"source_allowed_tags",
	{
		sourceId: text()
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		position: integer().notNull(),
		pattern: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.sourceId, t.position] })],
);

export const runs = sqliteTable(
	"runs",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		sourceId: text()
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		startedAt: integer({ mode: "timestamp" }).notNull(),
		durMs: integer().notNull(),
		/** Rows for a registry or an api, pages for a crawl. */
		fetched: integer().notNull(),
		/** Candidates the run created or refreshed. */
		cands: integer().notNull(),
		errors: integer().notNull(),
		/** `partial` finished but with errors worth showing; `failed` produced nothing. */
		result: text({ enum: ["ok", "partial", "failed"] }).notNull(),
		/** The detail after the result: "2 rows skipped", "401 unauthorized". */
		message: text(),
	},
	(t) => [index("runs_source_idx").on(t.sourceId, t.startedAt)],
);

export const areas = sqliteTable("areas", {
	id: text().primaryKey(),
	name: text().notNull(),
	def: text({ enum: ["relation", "radius"] }).notNull(),
	/** The OSM relation id of a boundary area. */
	rel: text(),
	/** The boundary's `admin_level`. */
	level: integer(),
	/** The Nominatim display name of the picked boundary, which says which "Montauban" it is. */
	displayName: text(),
	/** `[south, west, north, east]`, the order Overpass takes. Null for a radius area. */
	bbox: text({ mode: "json" }).$type<[number, number, number, number]>(),
	centerLat: real().notNull(),
	centerLon: real().notNull(),
	km: real(),
	radius: integer(),
	sqkm: real().notNull(),
	/** OSM POIs inside the boundary as Overpass last counted them; null until a run has. */
	pois: integer(),
	/** Paused areas are skipped by the pipeline. */
	paused: integer({ mode: "boolean" }).notNull().default(false),
	/** When a run last processed the area; null means none has, which the screens call "first run queued". */
	lastRunAt: integer({ mode: "timestamp" }),
});

export const areaSources = sqliteTable(
	"area_sources",
	{
		areaId: text()
			.notNull()
			.references(() => areas.id, { onDelete: "cascade" }),
		sourceId: text()
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
	},
	(t) => [
		primaryKey({ columns: [t.areaId, t.sourceId] }),
		index("area_sources_source_idx").on(t.sourceId),
	],
);

export const candidates = sqliteTable(
	"candidates",
	{
		id: text().primaryKey(),
		/** `node/123`. Null for a candidate that proposes a POI OSM does not have yet. */
		osmId: text(),
		/** The source's own id for the record. With `sourceId` it is what a re-run upserts on. */
		sourceRecordKey: text().notNull(),
		/** Hash of what the source said last time, so a re-run can tell an unchanged record from a moved one. */
		contentHash: text(),
		/** When a run last saw the record. */
		seenAt: integer({ mode: "timestamp" }),
		areaId: text()
			.notNull()
			.references(() => areas.id, { onDelete: "cascade" }),
		sourceId: text()
			.notNull()
			.references(() => sources.id),
		type: text({ enum: ["new", "update", "closure"] }).notNull(),
		name: text().notNull(),
		addr: text().notNull(),
		lat: real().notNull(),
		lon: real().notNull(),
		conf: real().notNull(),
		/** The OSM object version the tags were computed against; 0 when there is no `osmId`. */
		version: integer().notNull(),
		/** When the source was fetched. Age and staleness are derived from it, never stored. */
		fetchedAt: integer({ mode: "timestamp" }).notNull(),
		baseVersion: integer(),
		/** Set only when upstream moved on: `Candidate.conflict` is this being non-null. */
		headVersion: integer(),
		conflictWho: text(),
		/** The object's tags the candidate leaves alone, shown for context. */
		unchangedTags: text({ mode: "json" }).$type<{ k: string; v: string }[]>().notNull().default([]),
	},
	(t) => [
		uniqueIndex("candidates_source_record_idx").on(t.sourceId, t.sourceRecordKey),
		index("candidates_queue_idx").on(t.areaId, t.conf),
		index("candidates_source_idx").on(t.sourceId),
		index("candidates_fetched_idx").on(t.fetchedAt),
	],
);

export const candidateNearby = sqliteTable(
	"candidate_nearby",
	{
		candidateId: text()
			.notNull()
			.references(() => candidates.id, { onDelete: "cascade" }),
		position: integer().notNull(),
		label: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.candidateId, t.position] })],
);

export const candidateConflictTags = sqliteTable(
	"candidate_conflict_tags",
	{
		candidateId: text()
			.notNull()
			.references(() => candidates.id, { onDelete: "cascade" }),
		side: text({ enum: ["theirs", "ours"] }).notNull(),
		position: integer().notNull(),
		k: text().notNull(),
		v: text().notNull(),
	},
	(t) => [primaryKey({ columns: [t.candidateId, t.side, t.position] })],
);

export const tags = sqliteTable(
	"candidate_tags",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		candidateId: text()
			.notNull()
			.references(() => candidates.id, { onDelete: "cascade" }),
		position: integer().notNull(),
		op: text({ enum: ["add", "mod", "del"] }).notNull(),
		k: text().notNull(),
		v: text().notNull(),
		was: text(),
		conf: real().notNull(),
		invalid: integer({ mode: "boolean" }).notNull().default(false),
		invalidMsg: text(),
		invalidHint: text(),
	},
	(t) => [uniqueIndex("candidate_tags_position_idx").on(t.candidateId, t.position)],
);

export const evidence = sqliteTable(
	"evidence",
	{
		id: integer().primaryKey({ autoIncrement: true }),
		tagId: integer()
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		path: text().notNull(),
		url: text().notNull(),
		when: text().notNull(),
		kind: text().notNull(),
		conf: real().notNull(),
	},
	(t) => [uniqueIndex("evidence_tag_idx").on(t.tagId)],
);

export const evidenceParts = sqliteTable(
	"evidence_parts",
	{
		evidenceId: integer()
			.notNull()
			.references(() => evidence.id, { onDelete: "cascade" }),
		position: integer().notNull(),
		text: text().notNull(),
		mark: integer({ mode: "boolean" }).notNull(),
	},
	(t) => [primaryKey({ columns: [t.evidenceId, t.position] })],
);

export const changesets = sqliteTable(
	"changesets",
	{
		id: text().primaryKey(),
		/** Null when the upload failed, so OSM never accepted the changeset under this id. */
		osmId: text(),
		/** Empty when there is no OSM changeset to link to. */
		url: text().notNull(),
		uploadedAt: integer({ mode: "timestamp" }).notNull(),
		comment: text().notNull(),
		objects: text().notNull(),
		result: text().notNull(),
		/** What OSM or the network said when the upload failed; null on success. */
		error: text(),
		uploadedBy: text().references(() => users.id, { onDelete: "set null" }),
	},
	(t) => [index("changesets_uploaded_idx").on(t.uploadedAt)],
);

/**
 * A candidate leaves the queue exactly once. `changesetId` stays null while the
 * accepted tags are staged, and is filled by the upload that writes them, so
 * "staged" is `kind = accepted and changeset_id is null` rather than a flag that
 * could disagree with the changeset table.
 */
export const decisions = sqliteTable(
	"candidate_decisions",
	{
		candidateId: text()
			.primaryKey()
			.references(() => candidates.id, { onDelete: "cascade" }),
		kind: text({ enum: ["accepted", "rejected"] }).notNull(),
		userId: text()
			.notNull()
			.references(() => users.id),
		decidedAt: integer({ mode: "timestamp" }).notNull(),
		changesetId: text().references(() => changesets.id),
	},
	(t) => [index("decisions_changeset_idx").on(t.changesetId)],
);

/** The tags an accept selected — a subset of the candidate's, chosen at accept time. */
export const decisionTags = sqliteTable(
	"decision_tags",
	{
		candidateId: text()
			.notNull()
			.references(() => decisions.candidateId, { onDelete: "cascade" }),
		tagId: integer()
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.candidateId, t.tagId] })],
);

export const usersRelations = relations(users, ({ many, one }) => ({
	sessions: many(sessions),
	settings: one(userSettings, { fields: [users.id], references: [userSettings.userId] }),
	decisions: many(decisions),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
	user: one(users, { fields: [userSettings.userId], references: [users.id] }),
}));

export const decisionsRelations = relations(decisions, ({ one, many }) => ({
	candidate: one(candidates, { fields: [decisions.candidateId], references: [candidates.id] }),
	user: one(users, { fields: [decisions.userId], references: [users.id] }),
	changeset: one(changesets, { fields: [decisions.changesetId], references: [changesets.id] }),
	tags: many(decisionTags),
}));

export const decisionTagsRelations = relations(decisionTags, ({ one }) => ({
	decision: one(decisions, {
		fields: [decisionTags.candidateId],
		references: [decisions.candidateId],
	}),
	tag: one(tags, { fields: [decisionTags.tagId], references: [tags.id] }),
}));

export const changesetsRelations = relations(changesets, ({ many }) => ({
	decisions: many(decisions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const sourcesRelations = relations(sources, ({ many }) => ({
	allowedTags: many(sourceAllowedTags),
	runs: many(runs),
	areas: many(areaSources),
	candidates: many(candidates),
}));

export const sourceAllowedTagsRelations = relations(sourceAllowedTags, ({ one }) => ({
	source: one(sources, { fields: [sourceAllowedTags.sourceId], references: [sources.id] }),
}));

export const runsRelations = relations(runs, ({ one }) => ({
	source: one(sources, { fields: [runs.sourceId], references: [sources.id] }),
}));

export const areasRelations = relations(areas, ({ many }) => ({
	sources: many(areaSources),
	candidates: many(candidates),
}));

export const areaSourcesRelations = relations(areaSources, ({ one }) => ({
	area: one(areas, { fields: [areaSources.areaId], references: [areas.id] }),
	source: one(sources, { fields: [areaSources.sourceId], references: [sources.id] }),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
	area: one(areas, { fields: [candidates.areaId], references: [areas.id] }),
	source: one(sources, { fields: [candidates.sourceId], references: [sources.id] }),
	tags: many(tags),
	nearby: many(candidateNearby),
	conflictTags: many(candidateConflictTags),
	decision: one(decisions, { fields: [candidates.id], references: [decisions.candidateId] }),
}));

export const candidateNearbyRelations = relations(candidateNearby, ({ one }) => ({
	candidate: one(candidates, {
		fields: [candidateNearby.candidateId],
		references: [candidates.id],
	}),
}));

export const candidateConflictTagsRelations = relations(candidateConflictTags, ({ one }) => ({
	candidate: one(candidates, {
		fields: [candidateConflictTags.candidateId],
		references: [candidates.id],
	}),
}));

export const tagsRelations = relations(tags, ({ one }) => ({
	candidate: one(candidates, { fields: [tags.candidateId], references: [candidates.id] }),
	evidence: one(evidence, { fields: [tags.id], references: [evidence.tagId] }),
}));

export const evidenceRelations = relations(evidence, ({ one, many }) => ({
	tag: one(tags, { fields: [evidence.tagId], references: [tags.id] }),
	parts: many(evidenceParts),
}));

export const evidencePartsRelations = relations(evidenceParts, ({ one }) => ({
	evidence: one(evidence, { fields: [evidenceParts.evidenceId], references: [evidence.id] }),
}));
