import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ndjson, requestPinned } from "./http";

describe("ndjson", () => {
	it("decodes a character split across two chunks and a last line without a newline", async () => {
		const bytes = new TextEncoder().encode('{"n":"é"}\n{"n":"b"}');
		const cut = bytes.indexOf(0xc3) + 1;
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(bytes.slice(0, cut));
				c.enqueue(bytes.slice(cut));
				c.close();
			},
		});
		const out: unknown[] = [];
		for await (const row of ndjson(body)) out.push(row);
		expect(out).toEqual([{ n: "é" }, { n: "b" }]);
	});
});

/** `.invalid` never resolves (RFC 2606), so a request reaching the server cannot have looked the name up. */
async function serve(handler: RequestListener, run: (base: string) => Promise<void>) {
	const server = createServer(handler);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	try {
		await run(`http://rebind.invalid:${(server.address() as AddressInfo).port}`);
	} finally {
		server.closeAllConnections();
		server.close();
	}
}

describe("requestPinned", () => {
	it("connects to the pinned address, never resolving the name, which stays the Host", async () => {
		const seen: string[] = [];
		await serve(
			(req, res) => {
				seen.push(
					`${req.headers.host} ${req.headers["accept-encoding"]} ${req.socket.localAddress}`,
				);
				res.setHeader("content-type", "text/html");
				res.end("<p>ok</p>");
			},
			async (base) => {
				const res = await requestPinned(new URL(`${base}/x`), "127.0.0.1", 5_000);
				expect(res.headers.get("content-type")).toBe("text/html");
				expect(await res.text()).toBe("<p>ok</p>");
				expect(seen).toEqual([`${new URL(base).host} identity 127.0.0.1`]);
			},
		);
	});

	it("hands back a listed redirect unfollowed and refuses any other status or an encoded body", async () => {
		await serve(
			(req, res) => {
				if (req.url === "/moved") res.writeHead(301, { location: "/elsewhere" }).end();
				else if (req.url === "/gzip") res.writeHead(200, { "content-encoding": "gzip" }).end("x");
				else res.writeHead(404).end();
			},
			async (base) => {
				const moved = await requestPinned(new URL(`${base}/moved`), "127.0.0.1", 5_000, [301]);
				expect([moved.status, moved.headers.get("location")]).toEqual([301, "/elsewhere"]);
				await moved.body?.cancel();
				await expect(requestPinned(new URL(`${base}/moved`), "127.0.0.1", 5_000)).rejects.toThrow(
					/: 301/,
				);
				await expect(requestPinned(new URL(`${base}/gzip`), "127.0.0.1", 5_000)).rejects.toThrow(
					/answered gzip/,
				);
				await expect(requestPinned(new URL(`${base}/none`), "127.0.0.1", 5_000)).rejects.toThrow(
					/: 404/,
				);
			},
		);
	});

	it("times out a body that stalls after its headers", async () => {
		await serve(
			(_req, res) => {
				res.writeHead(200, { "content-type": "text/html" });
				res.write("<p>start");
			},
			async (base) => {
				const res = await requestPinned(new URL(base), "127.0.0.1", 200);
				await expect(res.text()).rejects.toThrow(/within 0.2 s/);
			},
		);
	});
});
