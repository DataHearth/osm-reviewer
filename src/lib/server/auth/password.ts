import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keylen: number,
	options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** `scrypt$N$r$p$salt$key`, both fields base64 — the parameters travel with the hash
    so raising the cost later does not invalidate the hashes already stored. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LENGTH);
	const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM);
	const parts = [COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64"), key.toString("base64")];
	return `scrypt$${parts.join("$")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
	if (!stored) return false;
	const [scheme, n, r, p, salt, key] = stored.split("$");
	if (scheme !== "scrypt" || !key) return false;

	const expected = Buffer.from(key, "base64");
	const actual = await derive(password, Buffer.from(salt, "base64"), +n, +r, +p, expected.length);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function derive(
	password: string,
	salt: Buffer,
	n: number,
	r: number,
	p: number,
	keylen = KEY_LENGTH,
): Promise<Buffer> {
	return scryptAsync(password.normalize("NFKC"), salt, keylen, { N: n, r, p });
}
