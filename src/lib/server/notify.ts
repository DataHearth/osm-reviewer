import { createHmac } from "node:crypto";
import { count, eq, isNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { instanceRow } from "$lib/server/settings";
import { version } from "../../../package.json";

export type NotifyEvent = "queue" | "sourceFailed" | "uploadFailed" | "runFinished";

export type ChannelResult = { channel: "ntfy" | "webhook" | "email"; ok: boolean; error?: string };

type Row = Awaited<ReturnType<typeof instanceRow>>;

const TIMEOUT_MS = 10_000;
const TITLES: Record<NotifyEvent, string> = {
	queue: "Queue is filling up",
	sourceFailed: "Source run failed",
	uploadFailed: "Changeset upload failed",
	runFinished: "Pipeline run finished",
};
const EVENT_COLUMN = {
	queue: "eventQueue",
	sourceFailed: "eventSourceFailed",
	uploadFailed: "eventUploadFailed",
	runFinished: "eventRunFinished",
} as const;

/**
 * Set once a queue notification went out, cleared when the pending count is seen back
 * under the ceiling, so a queue that stays over it announces itself once per crossing.
 * In memory: a restart while still over the ceiling announces again, which is acceptable.
 */
let queueLatched = false;

async function post(url: string, init: RequestInit) {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Header values must be latin-1, so the title stays ASCII and the message rides in the body. */
const sendNtfy = (s: Row, event: NotifyEvent, message: string) =>
	post(`${s.ntfyServer.replace(/\/+$/, "")}/${encodeURIComponent(s.ntfyTopic)}`, {
		method: "POST",
		headers: { Title: TITLES[event], "User-Agent": `osm-reviewer/${version}` },
		body: message,
	});

export const signBody = (body: string, secret: string) =>
	"sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const sendWebhook = (s: Row, event: NotifyEvent, message: string) => {
	const body = JSON.stringify({ event, message, at: new Date().toISOString() });
	return post(s.webhookUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": `osm-reviewer/${version}`,
			...(s.webhookSecret ? { "X-Signature": signBody(body, s.webhookSecret) } : {}),
		},
		body,
	});
};

/** `smtp://` and `smtps://` URLs, optionally with credentials; a bare `host:port` is plain SMTP. */
export const relayUrl = (relay: string) =>
	/^smtps?:\/\//i.test(relay) ? relay : `smtp://${relay}`;

async function sendEmail(s: Row, event: NotifyEvent, message: string) {
	const url = new URL(relayUrl(s.emailRelay));
	const transport = nodemailer.createTransport({
		host: url.hostname,
		port: url.port ? Number(url.port) : url.protocol === "smtps:" ? 465 : 25,
		secure: url.protocol === "smtps:",
		auth: url.username
			? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
			: undefined,
		connectionTimeout: TIMEOUT_MS,
		greetingTimeout: TIMEOUT_MS,
		socketTimeout: TIMEOUT_MS,
	});
	try {
		await transport.sendMail({
			from: `osm-reviewer <osm-reviewer@${url.hostname}>`,
			to: s.emailTo,
			subject: `[osm-reviewer] ${TITLES[event]}`,
			text: message,
		});
	} finally {
		transport.close();
	}
}

const channels = [
	["ntfy", (s: Row) => s.ntfyOn && s.ntfyTopic !== "", sendNtfy],
	["webhook", (s: Row) => s.webhookOn && s.webhookUrl !== "", sendWebhook],
	["email", (s: Row) => s.emailOn && s.emailTo !== "" && s.emailRelay !== "", sendEmail],
] as const;

async function deliver(s: Row, event: NotifyEvent, message: string) {
	return Promise.all(
		channels
			.filter(([, enabled]) => enabled(s))
			.map(async ([channel, , send]): Promise<ChannelResult> => {
				try {
					await send(s, event, message);
					return { channel, ok: true };
				} catch (err) {
					return { channel, ok: false, error: err instanceof Error ? err.message : String(err) };
				}
			}),
	);
}

/** Never throws: a failing channel must not fail the run or the upload that reported it. */
export async function notify(db: Db, event: NotifyEvent, message: string): Promise<void> {
	try {
		const s = await instanceRow(db);
		if (event === "queue") {
			const pending =
				db
					.select({ n: count() })
					.from(t.candidates)
					.leftJoin(t.decisions, eq(t.decisions.candidateId, t.candidates.id))
					.where(isNull(t.decisions.candidateId))
					.get()?.n ?? 0;
			if (pending <= s.queueOver) {
				queueLatched = false;
				return;
			}
			if (queueLatched) return;
		}
		if (!s[EVENT_COLUMN[event]]) return;
		const results = await deliver(s, event, message);
		for (const r of results) if (!r.ok) console.error(`notify: ${r.channel} failed: ${r.error}`);
		if (event === "queue" && results.some((r) => r.ok)) queueLatched = true;
	} catch (err) {
		console.error("notify:", err);
	}
}

/** Sends to every enabled channel, ignoring the event switches, and reports each outcome. */
export async function sendTest(db: Db): Promise<ChannelResult[]> {
	return deliver(await instanceRow(db), "runFinished", "Test notification from osm-reviewer.");
}
