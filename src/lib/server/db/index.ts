import { env } from "$env/dynamic/private";
import { createDb } from "./client";

export const db = createDb(env.DATABASE_PATH);
