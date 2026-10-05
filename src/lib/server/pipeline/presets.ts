import { education } from "./fr/education";
import { irve } from "./fr/irve";
import type { Preset } from "./preset";

const PRESETS: Preset[] = [irve, education];

export const presetById = (id: string | null) => PRESETS.find((p) => p.id === id);

export const detectPreset = (columns: string[]) => PRESETS.find((p) => p.detect(columns));
