import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedFor } from "./instance";

describe("cachedFor", () => {
	afterEach(() => vi.useRealTimers());

	it("asks once per window, however often it is read", async () => {
		vi.useFakeTimers();
		const probe = vi.fn(async () => "reachable");
		const read = cachedFor(60_000, probe);

		await Promise.all([read(), read()]);
		vi.advanceTimersByTime(59_000);
		expect(await read()).toBe("reachable");
		expect(probe).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1_000);
		await read();
		expect(probe).toHaveBeenCalledTimes(2);
	});
});
