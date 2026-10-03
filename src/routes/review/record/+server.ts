import { error, json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import * as t from "$lib/server/db/schema";
import { requireUser } from "$lib/server/user";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, locals }) => {
	requireUser(locals);
	const row = db
		.select({ record: t.candidates.record })
		.from(t.candidates)
		.where(eq(t.candidates.id, url.searchParams.get("id") ?? ""))
		.get();
	if (!row) error(404, "no such candidate");
	return json({ record: row.record });
};
