import { version } from "../../../../package.json";
import { PipelineError } from "./types";

export const userAgent = () =>
	`osm-reviewer/${version} (+${process.env.ORIGIN || "http://localhost"})`;

export const JSON_TIMEOUT_MS = 30_000;
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
