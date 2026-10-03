import { describe, expect, it } from "vitest";
import { redact, stripCredentials } from "./diagnostics";

describe("redact", () => {
	it("blanks secrets by key, at any depth, and leaves empty ones empty", () => {
		expect(
			redact({
				osm: { clientId: "id", clientSecret: "s3" },
				llm: { apiKey: "k", model: "m" },
				webhook: { secret: "" },
				list: [{ token: "t" }],
			}),
		).toEqual({
			osm: { clientId: "id", clientSecret: "[redacted]" },
			llm: { apiKey: "[redacted]", model: "m" },
			webhook: { secret: "" },
			list: [{ token: "[redacted]" }],
		});
	});

	it("strips credentials out of URLs", () => {
		expect(stripCredentials("smtps://me:pw@mail.lan:465")).toBe("smtps://[redacted]@mail.lan:465");
		expect(stripCredentials("smtp://smtp.lan:587")).toBe("smtp://smtp.lan:587");
	});
});
