import { describe, expect, it } from "vitest";
import { csvRows, pickResource, sniffDelimiter } from "./registry";

const stream = (...parts: string[]) =>
	new ReadableStream<Uint8Array>({
		start(c) {
			for (const p of parts) c.enqueue(new TextEncoder().encode(p));
			c.close();
		},
	});

async function rows(body: ReadableStream<Uint8Array>) {
	const out = [];
	for await (const r of csvRows(body, () => {})) out.push(r);
	return out;
}

describe("csvRows", () => {
	it("reads a semicolon file full of accents", async () => {
		const body = stream("﻿nom;adresse\nPharmacie Élysée;", "12 rue de l'Église\n");
		expect(await rows(body)).toEqual([{ nom: "Pharmacie Élysée", adresse: "12 rue de l'Église" }]);
	});

	it("keeps a comma file's unquoted semicolons inside their field", async () => {
		const body = stream("nom_station,horaires\nGare Part-Dieu,Mo-Fr 08:00-18:00;Sa 09:00-12:00\n");
		expect(await rows(body)).toEqual([
			{ nom_station: "Gare Part-Dieu", horaires: "Mo-Fr 08:00-18:00;Sa 09:00-12:00" },
		]);
	});

	it("yields nothing for an empty body", async () => {
		expect(await rows(stream())).toEqual([]);
	});
});

describe("sniffDelimiter", () => {
	it("decides on the header line alone", () => {
		expect(sniffDelimiter("a;b;c\n1,5;2,5;3")).toBe(";");
		expect(sniffDelimiter("a,b,c\nx;y;z;w;v")).toBe(",");
	});
});

describe("pickResource", () => {
	it("ignores a newer documentation CSV that also says consolidation", () => {
		const picked = pickResource([
			{
				format: "csv",
				type: "main",
				url: "https://x.test/data.csv",
				title: "Consolidation v2.3.1",
				last_modified: "2026-10-03T03:27",
			},
			{
				format: "geojson",
				type: "main",
				url: "https://x.test/data.geojson",
				title: "Export geojson",
				last_modified: "2026-10-03T03:28",
			},
			{
				format: "csv",
				type: "documentation",
				url: "https://x.test/doc.csv",
				title: "Documentation sur la consolidation",
				last_modified: "2026-10-03T03:29",
			},
		]);
		expect(picked?.url).toBe("https://x.test/data.csv");
	});
});
