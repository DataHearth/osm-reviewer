import type { Db } from "$lib/server/db/client";

export type NotifyEvent = "queue" | "sourceFailed" | "uploadFailed" | "runFinished";

export async function notify(_db: Db, _event: NotifyEvent, _message: string): Promise<void> {
	// ponytail: the ops part fills this; callers already pass everything a channel needs.
}
