import { deserialize } from "$app/forms";
import { invalidateAll } from "$app/navigation";

export type PostResult = { ok: true } | { ok: false; message: string };

/**
 * A write behind a control that is already a plain button — a checkbox, a slider,
 * a toggle. The named action still validates with the same Zod schema a form
 * would; only the no-JS path is missing, and these controls have no no-JS path.
 */
export async function post(
	action: string,
	fields: Record<string, string | number | boolean>,
): Promise<PostResult> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, String(v));

	const res = await fetch(action, {
		method: "POST",
		headers: { "x-sveltekit-action": "true" },
		body,
	});
	const result = deserialize(await res.text());

	if (result.type === "error")
		return { ok: false, message: result.error?.message ?? "request failed" };
	await invalidateAll();
	if (result.type === "failure") {
		const form = result.data?.form as { message?: string } | undefined;
		return { ok: false, message: form?.message ?? "rejected" };
	}
	return { ok: true };
}
