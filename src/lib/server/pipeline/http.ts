import { request as httpGet, type IncomingMessage } from "node:http";
import { request as httpsGet } from "node:https";
import { isIPv6, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { version } from "../../../../package.json";
import { PipelineError } from "./types";

export const userAgent = () =>
	`osm-reviewer/${version} (+${process.env.ORIGIN || "http://localhost"})`;

const JSON_TIMEOUT_MS = 30_000;
/** A 158 MB registry file over a slow link; the stream is read, not buffered, so this is only a ceiling. */
export const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;

function safeHost(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** Network failures and non-2xx answers both become a PipelineError the run reports. */
export async function request(
	url: string,
	init: RequestInit & { timeoutMs?: number } = {},
	okStatuses: number[] = [],
): Promise<Response> {
	const { timeoutMs = JSON_TIMEOUT_MS, headers, ...rest } = init;
	let res: Response;
	try {
		res = await fetch(url, {
			...rest,
			headers: { "user-agent": userAgent(), ...(headers as Record<string, string>) },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		throw new PipelineError(
			`${safeHost(url)}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!res.ok && !okStatuses.includes(res.status)) {
		await res.body?.cancel().catch(() => {});
		throw new PipelineError(`${safeHost(url)}: ${res.status} ${res.statusText}`.trim());
	}
	return res;
}

const NULL_BODY = [204, 205, 304];

/**
 * A GET that connects to `address` and nowhere else. `fetch` resolves the name again on its
 * own, so DNS could answer the check with a public address and the connection with a private
 * one; here the socket's lookup only ever returns `address`, while SNI and Host stay the
 * URL's hostname. Redirects come back unfollowed, the timeout runs until the body is done,
 * and the body is asked for as identity, since nothing decompresses it.
 */
export function requestPinned(
	url: URL,
	address: string,
	timeoutMs: number,
	okStatuses: number[] = [],
): Promise<Response> {
	const family = isIPv6(address) ? 6 : 4;
	const lookup: LookupFunction = (_host, opts, done) =>
		opts.all ? done(null, [{ address, family }]) : done(null, address, family);
	return new Promise((resolve, reject) => {
		const fail = (err: unknown) =>
			reject(
				err instanceof PipelineError
					? err
					: new PipelineError(`${url.host}: ${err instanceof Error ? err.message : String(err)}`),
			);
		let res: IncomingMessage | undefined;
		const req = (url.protocol === "https:" ? httpsGet : httpGet)(
			url,
			{ headers: { "user-agent": userAgent(), "accept-encoding": "identity" }, lookup },
			(answer) => {
				res = answer;
				answer.once("close", () => clearTimeout(timer));
				const status = answer.statusCode ?? 0;
				const encoding = answer.headers["content-encoding"];
				try {
					if (encoding && encoding.toLowerCase() !== "identity")
						throw new PipelineError(`${url.host}: answered ${encoding} where identity was asked`);
					if ((status < 200 || status > 299) && !okStatuses.includes(status))
						throw new PipelineError(`${url.host}: ${status} ${answer.statusMessage ?? ""}`.trim());
					const headers = new Headers();
					for (const [k, v] of Object.entries(answer.headers))
						for (const one of [v ?? []].flat()) headers.append(k, one);
					const empty = NULL_BODY.includes(status);
					if (empty) answer.resume();
					resolve(
						new Response(empty ? null : (Readable.toWeb(answer) as ReadableStream), {
							status,
							statusText: answer.statusMessage,
							headers,
						}),
					);
				} catch (err) {
					answer.destroy();
					fail(err);
				}
			},
		);
		const timer = setTimeout(
			() => (res ?? req).destroy(new Error(`no complete answer within ${timeoutMs / 1000} s`)),
			timeoutMs,
		);
		req.on("error", (err) => {
			clearTimeout(timer);
			fail(err);
		});
		req.end();
	});
}

export async function getJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
	const res = await request(url, init);
	try {
		return (await res.json()) as T;
	} catch {
		throw new PipelineError(`${safeHost(url)}: answer is not JSON`);
	}
}

/** Lines of newline-delimited JSON from a response body, decoded across chunk boundaries. */
export async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
	const decoder = new TextDecoder();
	let rest = "";
	for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
		rest += decoder.decode(chunk, { stream: true });
		let nl = rest.indexOf("\n");
		while (nl !== -1) {
			const line = rest.slice(0, nl).trim();
			rest = rest.slice(nl + 1);
			if (line) yield JSON.parse(line) as T;
			nl = rest.indexOf("\n");
		}
	}
	rest += decoder.decode();
	if (rest.trim()) yield JSON.parse(rest) as T;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The first `n` items of a stream, and the whole stream again with them back in front. */
export async function peek<T>(
	items: AsyncIterable<T>,
	n: number,
): Promise<{ head: T[]; all: AsyncIterable<T> }> {
	const it = items[Symbol.asyncIterator]();
	const head: T[] = [];
	let done = false;
	while (head.length < n) {
		const next = await it.next();
		if (next.done) {
			done = true;
			break;
		}
		head.push(next.value);
	}
	return {
		head,
		all: (async function* () {
			yield* head;
			while (!done) {
				const next = await it.next();
				if (next.done) return;
				yield next.value;
			}
		})(),
	};
}
