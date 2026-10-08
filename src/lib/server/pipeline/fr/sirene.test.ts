import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSirenCache, resolveSiren, sirene } from "./sirene";

const company = (siren: string, name: string, nature: string) => ({
	results: [{ siren, nom_raison_sociale: name, nature_juridique: nature }],
});

const answers: Record<string, () => Response> = {
	"200000000": () => Response.json(company("200000000", "CENTRE HOSPITALIER DU FOREZ", "7364")),
	"300000000": () => Response.json(company("300000000", "FONDO BRUNO", "1000")),
	"400000000": () => new Response("not found", { status: 404, statusText: "Not Found" }),
	"500000000": () => Response.json({ results: [] }),
	"600000000": () => Response.json(company("699999999", "ANOTHER", "5499")),
};

let fetched: string[];

beforeEach(() => {
	clearSirenCache();
	fetched = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const q = url.searchParams.get("q") ?? "";
			fetched.push(q);
			if (q === "700000000") throw new DOMException("timed out", "TimeoutError");
			return answers[q]?.() ?? new Response("{}", { status: 500 });
		}),
	);
});

afterEach(() => vi.unstubAllGlobals());

const proposed = async (siren: string) => {
	const failed = await resolveSiren(siren);
	return { failed, tags: sirene({ siren }, []) };
};

describe("fr/sirene", () => {
	it("proposes the legal name and the SIREN of a company, asking the register's host", async () => {
		expect(await proposed("200 000 000")).toEqual({
			failed: 0,
			tags: { operator: "CENTRE HOSPITALIER DU FOREZ", "operator:ref:FR:SIREN": "200000000" },
		});
		expect(fetched).toEqual(["200000000"]);
	});

	it("never proposes a natural person's name", async () => {
		expect(await proposed("300000000")).toEqual({ failed: 0, tags: {} });
	});

	it("proposes nothing for a SIREN the register does not know or answers with another", async () => {
		expect(await proposed("500000000")).toEqual({ failed: 0, tags: {} });
		expect(await proposed("600000000")).toEqual({ failed: 0, tags: {} });
	});

	it("counts a 404 and a timeout as failures and proposes nothing", async () => {
		expect(await proposed("400000000")).toEqual({ failed: 1, tags: {} });
		expect(await proposed("700000000")).toEqual({ failed: 1, tags: {} });
	});

	it("asks once per SIREN, a failure included, and not at all for what is no SIREN", async () => {
		await resolveSiren("200000000");
		await resolveSiren("200000000");
		await resolveSiren("400000000");
		await resolveSiren("400000000");
		expect(await resolveSiren("")).toBe(0);
		expect(await resolveSiren("DR BRUNO")).toBe(0);
		expect(fetched).toEqual(["200000000", "400000000"]);
	});
});
