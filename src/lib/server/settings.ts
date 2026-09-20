import { eq } from "drizzle-orm";
import { stamp } from "$lib/format";
import type { AccountForm, KeysForm, NotifForm, OsmForm } from "$lib/schemas/settings";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import type { OsmIdentity } from "$lib/types";

export interface SettingsPanes {
	account: AccountForm;
	osm: OsmForm;
	notif: NotifForm;
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
		notif: {
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
		},
		keys: { vim: s.vim, confirmAccept: s.confirmAccept, showHints: s.showHints },
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

export async function saveNotif(db: Db, userId: string, v: NotifForm) {
	await rowFor(db, userId);
	db.update(t.userSettings)
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
		.where(eq(t.userSettings.userId, userId))
		.run();
}

export async function saveKeys(db: Db, userId: string, v: KeysForm) {
	await rowFor(db, userId);
	db.update(t.userSettings)
		.set({ vim: v.vim, confirmAccept: v.confirmAccept, showHints: v.showHints })
		.where(eq(t.userSettings.userId, userId))
		.run();
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
