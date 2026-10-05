import { describe, expect, it } from "vitest";
import { ndjson } from "./http";

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
