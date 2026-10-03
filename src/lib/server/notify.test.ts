import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { relayUrl, signBody } from "./notify";

describe("signBody", () => {
	it("is sha256= plus the hex HMAC of the raw body", () => {
		const body = '{"event":"queue"}';
		expect(signBody(body, "s")).toBe(
			`sha256=${createHmac("sha256", "s").update(body).digest("hex")}`,
		);
	});
});

describe("relayUrl", () => {
	it("keeps smtp and smtps URLs and promotes a bare host:port", () => {
		expect(relayUrl("smtps://u:p@mail.lan:465")).toBe("smtps://u:p@mail.lan:465");
		expect(relayUrl("smtp.lan:587")).toBe("smtp://smtp.lan:587");
	});
});
