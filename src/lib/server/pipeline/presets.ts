import { irve } from "./fr/irve";
import { education } from "./fr/school-preset";
import type { Preset } from "./preset";

const PRESETS: Preset[] = [irve, education];

/** By the preset's own id, or by the id of the mapping it applies (`FR:school`), which is how a source is pointed at one. */
export const presetById = (id: string | null) =>
	PRESETS.find((p) => p.id === id || p.mapping === id);

export const detectPreset = (columns: string[]) => PRESETS.find((p) => p.detect(columns));
