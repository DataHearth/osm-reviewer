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

	it("leaves nothing secret in the notification settings a reviewer is shown", () => {
		const shown = redact({
			ntfy: { on: true, server: "https://bot:pw@ntfy.lan", topic: "osm" },
			webhook: { on: true, url: "https://hooks.lan/in", secret: "hmac-key" },
			email: { on: true, to: "ops@lan", relay: "smtp://alerts:hunter2@mail.lan:587" },
		});
		expect(JSON.stringify(shown)).not.toMatch(/pw|hmac-key|hunter2/);
	});

	it("strips credentials out of URLs", () => {
		expect(stripCredentials("smtps://me:pw@mail.lan:465")).toBe("smtps://[redacted]@mail.lan:465");
		expect(stripCredentials("smtp://smtp.lan:587")).toBe("smtp://smtp.lan:587");
	});

	it("strips up to the last @ of the authority, with or without a scheme", () => {
		expect(stripCredentials("smtp://alerts@corp.example:hunter2@mail.corp.example:587")).toBe(
			"smtp://[redacted]@mail.corp.example:587",
		);
		expect(stripCredentials("user:pass@mail.lan:587")).toBe("[redacted]@mail.lan:587");
		expect(stripCredentials("https://ntfy.lan/topic@x")).toBe("https://ntfy.lan/topic@x");
		expect(stripCredentials("ops@corp.example")).toBe("ops@corp.example");
	});
});
