// See https://svelte.dev/docs/kit/types#app
import type { Session, User } from "$lib/types";

declare global {
	namespace App {
		interface Locals {
			user: User | null;
			session: Session | null;
			sessionToken: string | null;
		}

		interface PageData {
			user?: User | null;
			session?: Session | null;
		}
	}
}
