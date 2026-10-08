import type { Extraction, OsmElement } from "../types";
import type { MatchedBy } from "./describe";
import type { Main, TagOp } from "./ops";

export type Level = "hard" | "soft";

/**
 * What a kit may call back into. These depend on the registry, so a kit is a factory over them
 * and imports only leaf modules: nothing here is evaluated while modules load.
 */
export interface Lib {
	mainOf(x: Partial<Pick<Extraction, "tags">>): Main | undefined;
	sameKind(k: string, v: string, tags: Record<string, string>): boolean;
	shell(tags: Record<string, string>): boolean;
	sameValue(key: string, a: string, b: string): boolean;
	keyOn(k: string, current: Record<string, string>): string;
	rulesOut(e: OsmElement, refs: Record<string, string>, level: Level): boolean;
	idsOn(key: string, e: OsmElement): string[];
}

export type Subject = Pick<Extraction, "refs" | "name"> &
	Partial<Pick<Extraction, "tags" | "absent" | "fit" | "kind" | "addr" | "key">>;

export interface Fit {
	agree: number;
	against: number;
	types: boolean;
	score: number;
}

export type Hit = { e: OsmElement; d: number };

export interface RefHooks {
	/** The id read off the object some other way than under its keys. */
	also?(e: Pick<OsmElement, "tags">): string | undefined;
	/** Every form a value is found under; one starting `~` is believed only nearby. */
	keys?(v: string): string[];
	/** The ids an object carries, as the reviewer would count them. */
	holds?(e: OsmElement): string;
	/** Whether one id of the record and one of the object name the same thing. */
	related?(a: string, b: string): boolean;
	/** The words of the banners for an object carrying another's id; wording only. */
	rival?(e: OsmElement): { inline: string; line: string };
}

export interface Kit {
	excludes?(x: Subject, e: OsmElement, matched?: OsmElement): boolean;
	fit?(x: Subject, e: OsmElement): Fit | null;
	certain?(
		x: Subject,
		e: OsmElement,
		at: { agree: number; edge: number; renumbered: boolean; fits: Fit | null },
	): { known: boolean; exact: boolean };
	counts?(
		x: Subject,
		el: OsmElement,
		at: { split: boolean; others: boolean },
		ops: TagOp[],
	): { drop: TagOp[]; note: string } | null;
	pick?(x: Subject, hits: Hit[]): OsmElement | null;
	ownGrounds?(x: Subject, grounds: OsmElement, els: OsmElement[]): boolean;
	place?(x: Subject, el: OsmElement): { leave: (o: TagOp) => boolean; notes: string[] } | null;
	namesake?(
		x: Subject,
		el: OsmElement,
		e: OsmElement,
		at: { els: OsmElement[]; matchedBy: MatchedBy },
	): boolean;
	matchedBanners?(
		x: Subject,
		el: OsmElement,
		at: { grounds: OsmElement | null; split: Hit[]; els: OsmElement[] },
	): { before: string[]; here: Hit[]; after: string[] };
	newBanners?(
		x: Subject & Pick<Extraction, "lat" | "lon">,
		at: {
			points: Pick<Extraction, "lat" | "lon">[];
			els: OsmElement[];
			matchedBy: MatchedBy;
			listed?: Set<string>;
		},
	): { sibling: string | null; unlisted: string[] };
	/** Words that say what a place of this kind is, not which one: left out when names are compared. */
	words?: ReadonlySet<string>;
	accepts?: Record<string, (tags: Record<string, string>) => boolean>;
	lookalikes?: Record<string, (x: Subject, e: OsmElement) => boolean>;
	same?: Record<string, (a: string, b: string) => boolean>;
	refs?: Record<string, RefHooks>;
}

export type KitMethod =
	| "excludes"
	| "fit"
	| "certain"
	| "counts"
	| "pick"
	| "ownGrounds"
	| "place"
	| "namesake"
	| "matchedBanners"
	| "newBanners";

export const METHODS: KitMethod[] = [
	"excludes",
	"fit",
	"certain",
	"counts",
	"pick",
	"ownGrounds",
	"place",
	"namesake",
	"matchedBanners",
	"newBanners",
];

export type KitFactory = (lib: Lib) => Kit;
