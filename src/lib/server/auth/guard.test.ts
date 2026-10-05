import { isHttpError, isRedirect } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import type { User } from "$lib/types";
import { requireSession } from "./guard";

const event = (
	path: string,
	{
		method = "GET",
		headers = {} as Record<string, string>,
		data = false,
		user = null as User | null,
	} = {},
) => ({
	url: new URL(path, "http://x"),
	request: new Request(new URL(path, "http://x"), { method, headers }),
	isDataRequest: data,
	locals: { user, session: null, sessionToken: null },
});

const outcome = (e: ReturnType<typeof event>) => {
	try {
		requireSession(e);
		return "through";
	} catch (thrown) {
		if (isRedirect(thrown)) return thrown.location;
		if (isHttpError(thrown)) return thrown.status;
		throw thrown;
	}
};

describe("requireSession", () => {
	it("lets the sign-in and the built assets through without a session", () => {
		expect(outcome(event("/login", { method: "POST" }))).toBe("through");
		expect(outcome(event("/login/callback?code=c"))).toBe("through");
		expect(outcome(event("/_app/immutable/x.js"))).toBe("through");
	});

	it("redirects a navigation and a data request, keeping where they were going", () => {
		expect(outcome(event("/history?x=1", { headers: { accept: "text/html,*/*" } }))).toBe(
			"/login?redirectTo=%2Fhistory%3Fx%3D1",
		);
		expect(outcome(event("/history/7", { data: true }))).toBe("/login?redirectTo=%2Fhistory%2F7");
	});

	it("redirects an enhanced post to the page, not the action", () => {
		const headers = { "x-sveltekit-action": "true" };
		expect(outcome(event("/review?/accept", { method: "POST", headers }))).toBe(
			"/login?redirectTo=%2Freview",
		);
	});

	it("answers a fetch and a plain post with 401", () => {
		expect(outcome(event("/review/record?id=c1"))).toBe(401);
		expect(outcome(event("/review?/accept", { method: "POST" }))).toBe(401);
		const accept = { accept: "application/json" };
		expect(outcome(event("/review/record?id=c1", { headers: accept }))).toBe(401);
	});

	it("lets a signed-in request through", () => {
		const user = { id: "u" } as User;
		expect(outcome(event("/history", { data: true, user }))).toBe("through");
	});
});
