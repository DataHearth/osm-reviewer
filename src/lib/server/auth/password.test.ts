import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number },
) => Promise<Buffer>;

describe("hashPassword", () => {
	it("encodes the parameters alongside the hash", async () => {
		const [scheme, n, r, p, salt, key] = (await hashPassword("review")).split("$");
		expect(scheme).toBe("scrypt");
		expect([n, r, p]).toEqual(["16384", "8", "1"]);
		expect(Buffer.from(salt, "base64")).toHaveLength(16);
		expect(Buffer.from(key, "base64")).toHaveLength(64);
	});

	it("salts, so the same password never hashes twice the same way", async () => {
		expect(await hashPassword("review")).not.toBe(await hashPassword("review"));
	});
});

describe("verifyPassword", () => {
	it("accepts the password it was given", async () => {
		expect(await verifyPassword("review", await hashPassword("review"))).toBe(true);
	});

	it("rejects a wrong password", async () => {
		expect(await verifyPassword("Review", await hashPassword("review"))).toBe(false);
	});

	// An SSO-provisioned account has no local password; this must not throw.
	it("rejects a null hash", async () => {
		expect(await verifyPassword("review", null)).toBe(false);
	});

	it.each([
		["", "empty"],
		["not-a-hash", "unstructured"],
		["scrypt$16384$8$1$c2FsdA==", "truncated"],
		["bcrypt$16384$8$1$c2FsdA==$a2V5", "wrong scheme"],
	])("rejects a %s stored value (%s)", async (stored) => {
		expect(await verifyPassword("review", stored)).toBe(false);
	});

	// The hash is derived from the NFKC form, so the same characters entered in a
	// different normalisation still sign in.
	it("normalises before comparing", async () => {
		const composed = "café";
		expect(await verifyPassword("café", await hashPassword(composed))).toBe(true);
	});

	// The point of storing N/r/p: a hash written before the cost was raised must still
	// verify afterwards. Built by hand, because hashPassword only ever writes today's cost.
	it("verifies a hash written at an older cost", async () => {
		const salt = randomBytes(16);
		const key = await scryptAsync("review", salt, 64, { N: 8192, r: 8, p: 1 });
		const stored = `scrypt$8192$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

		expect(await verifyPassword("review", stored)).toBe(true);
		expect(await verifyPassword("wrong", stored)).toBe(false);
	});
});
