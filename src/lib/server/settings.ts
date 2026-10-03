import { eq } from "drizzle-orm";
import { stamp } from "$lib/format";
import { resolveBindings } from "$lib/keymap";
import type { AccountForm, KeysForm, NotifForm, OsmForm } from "$lib/schemas/settings";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import type { OsmIdentity } from "$lib/types";

export interface SettingsPanes {
	account: AccountForm;
	osm: OsmForm;
	keys: KeysForm;
	identity: OsmIdentity | null;
}

/**
 * Panes save one at a time, so the row has to exist before any of them writes:
 * a partial insert from the notifications pane would otherwise decide the OSM
 * defaults. Reading creates it from the column defaults instead.
 */
async function rowFor(db: Db, userId: string) {
	const existing = await db.query.userSettings.findFirst({ where: (s) => eq(s.userId, userId) });
	if (existing) return existing;
	await db.insert(t.userSettings).values({ userId }).onConflictDoNothing().run();
	const created = await db.query.userSettings.findFirst({ where: (s) => eq(s.userId, userId) });
	if (!created) throw new Error(`no settings row for ${userId}`);
	return created;
}

export async function loadSettings(db: Db, userId: string): Promise<SettingsPanes> {
	const s = await rowFor(db, userId);
	const user = await db.query.users.findFirst({ where: (u) => eq(u.id, userId) });

	return {
		account: { name: user?.name ?? "", email: user?.email ?? "" },
		osm: {
			target: s.osmTarget as OsmForm["target"],
			comment: s.osmComment,
			sourceTag: s.osmSourceTag,
			hashtag: s.osmHashtag,
			perChangeset: s.osmPerChangeset,
		},
		keys: {
			vim: s.vim,
			confirmAccept: s.confirmAccept,
			showHints: s.showHints,
			bindings: resolveBindings(s.bindings),
		},
		identity:
			user?.osm && s.osmConnected
				? {
						user: user.osm,
						connected: stamp(s.osmConnected),
						scopes: s.osmScopes,
					}
				: null,
	};
}

export async function saveOsm(db: Db, userId: string, v: OsmForm) {
	await rowFor(db, userId);
	db.update(t.userSettings)
		.set({
			osmTarget: v.target,
			osmComment: v.comment,
			osmSourceTag: v.sourceTag,
			osmHashtag: v.hashtag,
			osmPerChangeset: v.perChangeset,
		})
		.where(eq(t.userSettings.userId, userId))
		.run();
}

/** The instance's one row, created from the column defaults on first read. */
async function instanceRow(db: Db) {
	const existing = await db.query.instanceSettings.findFirst();
	if (existing) return existing;
	await db.insert(t.instanceSettings).values({ id: 1 }).onConflictDoNothing().run();
	const created = await db.query.instanceSettings.findFirst();
	if (!created) throw new Error("no instance settings row");
	return created;
}

export async function loadNotif(db: Db): Promise<NotifForm> {
	const s = await instanceRow(db);
	return {
		ntfy: { on: s.ntfyOn, server: s.ntfyServer, topic: s.ntfyTopic },
		webhook: { on: s.webhookOn, url: s.webhookUrl, secret: s.webhookSecret },
		email: { on: s.emailOn, to: s.emailTo, relay: s.emailRelay },
		queueOver: s.queueOver,
		events: {
			queue: s.eventQueue,
			sourceFailed: s.eventSourceFailed,
			uploadFailed: s.eventUploadFailed,
			runFinished: s.eventRunFinished,
		},
	};
}

export async function saveNotif(db: Db, v: NotifForm) {
	await instanceRow(db);
	db.update(t.instanceSettings)
		.set({
			ntfyOn: v.ntfy.on,
			ntfyServer: v.ntfy.server,
			ntfyTopic: v.ntfy.topic,
			webhookOn: v.webhook.on,
			webhookUrl: v.webhook.url,
			webhookSecret: v.webhook.secret,
			emailOn: v.email.on,
			emailTo: v.email.to,
			emailRelay: v.email.relay,
			queueOver: v.queueOver,
			eventQueue: v.events.queue,
			eventSourceFailed: v.events.sourceFailed,
			eventUploadFailed: v.events.uploadFailed,
			eventRunFinished: v.events.runFinished,
		})
		.run();
}

export async function saveKeys(db: Db, userId: string, v: KeysForm) {
	await rowFor(db, userId);
	db.update(t.userSettings)
		.set({
			vim: v.vim,
			confirmAccept: v.confirmAccept,
			showHints: v.showHints,
			bindings: v.bindings,
		})
		.where(eq(t.userSettings.userId, userId))
		.run();
}

/** What the root layout's key handler needs, on every screen. */
export async function loadKeys(db: Db, userId: string) {
	const s = await rowFor(db, userId);
	return {
		vim: s.vim,
		confirmAccept: s.confirmAccept,
		showHints: s.showHints,
		bindings: resolveBindings(s.bindings),
	};
}

export function saveAccount(db: Db, userId: string, v: AccountForm) {
	db.update(t.users).set({ name: v.name, email: v.email }).where(eq(t.users.id, userId)).run();
}

export function setOsmConnected(db: Db, userId: string, connected: boolean) {
	db.update(t.userSettings)
		.set({ osmConnected: connected ? new Date() : null })
		.where(eq(t.userSettings.userId, userId))
		.run();
}
