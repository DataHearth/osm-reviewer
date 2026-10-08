import { KITS } from "../kits";
import { mappings } from "../mapping/files";
import type { Mapping, RefRule } from "../mapping/schema";
import type { Selector } from "../tagfilter";
import { sameKind, shell as shellOf } from "../tagfilter";
import type { Extraction } from "../types";
import type { Kit, KitFactory, KitMethod, Lib, RefHooks } from "./kit";
import { keyOn, mainOf } from "./ops";
import { idsOn, rulesOut } from "./refs";
import { sameValue } from "./values";

/** The main keys every deployment has had since before the mappings declared them. */
const BASE_MAIN = ["amenity", "shop", "office", "tourism", "leisure", "craft", "healthcare"];

/** What makes a bare building a building and not a place: the base keys and `public_transport`. */
export const BARE_BUILDING_BLOCKERS = [...BASE_MAIN, "public_transport"];

export interface Scheme extends RefHooks {
	key: string;
	aliases: string[];
	fetch: Selector[];
	site: boolean;
	rules?: "hard" | "soft";
	neverReplace?: string;
	organisation?: string;
}

export interface Shell {
	k: string;
	v: string[];
	of: string;
}

export interface Registry {
	mainKeys: string[];
	selectorKeys: string[];
	kin: Map<string, string[]>;
	shell: Shell | null;
	lookalikes: Map<string, Selector[]>;
	schemes: Map<string, Scheme>;
	labelKeys: string[];
	kitOf: Map<string, Kit>;
	writes: Map<string, string[]>;
	kits: Kit[];
	accepts: Map<string, NonNullable<Kit["accepts"]>[string]>;
	lookalikeHooks: Map<string, NonNullable<Kit["lookalikes"]>[string]>;
	same: Map<string, NonNullable<Kit["same"]>[string]>;
}

const toSelector = (s: {
	k: string;
	v?: string[];
	not?: { k: string; v: string[] };
}): Selector => ({
	k: s.k,
	v: s.v ?? null,
	...(s.not ? { not: s.not } : {}),
});

const unique = (xs: string[]) => [...new Set(xs)];

export function lib(): Lib {
	return { mainOf, sameKind, shell: shellOf, sameValue, keyOn, rulesOut, idsOn };
}

export function buildRegistry(
	all: Mapping[],
	factories: Record<string, KitFactory>,
	forKits: Lib = lib(),
): Registry {
	const extraMain = unique(all.flatMap((m) => m.matching.main)).filter(
		(k) => !BASE_MAIN.includes(k),
	);
	const kin = new Map<string, string[]>();
	const lookalikes = new Map<string, Selector[]>();
	const schemes = new Map<string, Scheme>();
	const kitOf = new Map<string, Kit>();
	const writes = new Map<string, string[]>();
	const built = new Map<string, Kit>();
	let shell = null as Shell | null;
	for (const m of all) {
		const b = m.matching;
		writes.set(m.id, Object.keys(m.tags));
		for (const [pair, values] of Object.entries(b.kin ?? {})) kin.set(pair, values);
		for (const [pair, sels] of Object.entries(b.lookalikes ?? {}))
			lookalikes.set(pair, sels.map(toSelector));
		if (b.shell)
			shell = shell
				? { ...shell, v: unique([...shell.v, ...b.shell.v]) }
				: { k: b.shell.k, v: [...b.shell.v], of: b.shell.of };
		for (const [key, rule] of Object.entries(b.refs ?? {})) schemes.set(key, scheme(key, rule));
		if (b.kit) {
			const factory = factories[b.kit];
			if (!factory) throw new Error(`${m.id}: no kit named ${b.kit}`);
			const kit = built.get(b.kit) ?? factory(forKits);
			built.set(b.kit, kit);
			kitOf.set(m.id, kit);
		}
	}
	const kits = [...built.values()];
	const accepts: Registry["accepts"] = new Map();
	const lookalikeHooks: Registry["lookalikeHooks"] = new Map();
	const same: Registry["same"] = new Map();
	for (const kit of kits) {
		for (const [k, f] of Object.entries(kit.accepts ?? {})) accepts.set(k, f);
		for (const [k, f] of Object.entries(kit.lookalikes ?? {})) lookalikeHooks.set(k, f);
		for (const [k, f] of Object.entries(kit.same ?? {})) same.set(k, f);
		for (const [key, hooks] of Object.entries(kit.refs ?? {})) {
			const s = schemes.get(key);
			if (s) schemes.set(key, { ...s, ...hooks });
		}
	}
	const lookalikeKeys = [...lookalikes.values()].flatMap((sels) =>
		sels.filter((s) => s.v !== null).map((s) => s.k),
	);
	const mainKeys = [...BASE_MAIN, ...extraMain];
	return {
		mainKeys,
		selectorKeys: [...BARE_BUILDING_BLOCKERS, ...extraMain],
		kin,
		shell,
		lookalikes,
		schemes,
		labelKeys: unique([...mainKeys, ...lookalikeKeys, ...(shell ? [shell.k] : [])]),
		kitOf,
		writes,
		kits,
		accepts,
		lookalikeHooks,
		same,
	};
}

function scheme(key: string, rule: RefRule): Scheme {
	return {
		key,
		aliases: rule.aliases ?? [key],
		fetch: (rule.fetch ?? []).map(toSelector),
		site: rule.site ?? false,
		rules: rule.rules_out,
		neverReplace: rule.never_replace,
		organisation: rule.organisation,
	};
}

let built: Registry | null = null;

/** Built on the first call and kept; nothing reads it while modules load. */
export function registry(): Registry {
	built ??= buildRegistry(mappings(), KITS);
	return built;
}

/** Swaps the registry for one built from literal mappings, or back to the shipped ones. */
export function useMappings(all: Mapping[] | null, factories: Record<string, KitFactory> = KITS) {
	built = all ? buildRegistry(all, factories) : null;
}

export const mainKeys = () => registry().mainKeys;
export const selectorKeys = () => registry().selectorKeys;
export const labelKeys = () => registry().labelKeys;

export const kinValues = (k: string, v: string) => registry().kin.get(`${k}=${v}`) ?? [v];

/** The kit method answering for a record: its own kind's kit, else none. */
export function kit<M extends KitMethod>(
	x: Pick<Extraction, "kind"> | { kind?: string },
	method: M,
): Kit[M] | undefined {
	return x.kind ? registry().kitOf.get(x.kind)?.[method] : undefined;
}

export const wordsOf = (x: { kind?: string }) =>
	x.kind ? registry().kitOf.get(x.kind)?.words : undefined;

export const sameHook = (key: string) => registry().same.get(key);

export const lookalikeHook = (pair: string) => registry().lookalikeHooks.get(pair);
