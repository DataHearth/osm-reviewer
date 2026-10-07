import { Environment } from "@marcbachmann/cel-js";
import { COUNTRIES } from "../fr/country";
import { mobileFR, phoneFR } from "../fr/text";
import { truthy, website } from "../row";

export type Checked =
	| {
			ok: true;
			type: string;
			run: (context: Record<string, unknown>) => unknown;
			/** Every identifier and every `.field` the expression names, whether or not it is declared. */
			names: ReadonlySet<string>;
	  }
	| { ok: false; error: string };

interface Node {
	op: string;
	args: unknown;
}

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && "op" in v;

function namesIn(node: unknown, found: Set<string>): void {
	if (Array.isArray(node)) {
		for (const n of node) namesIn(n, found);
	} else if (isNode(node)) {
		if (node.op === "id" && typeof node.args === "string") found.add(node.args);
		if (node.op === "." && Array.isArray(node.args) && typeof node.args[1] === "string") {
			found.add(node.args[1]);
		}
		namesIn(node.args, found);
	}
}

const receiver = (
	name: string,
	returnType: string,
	params: string[],
	handler: (receiver: string, ...args: string[]) => unknown,
) => ({
	name,
	receiverType: "string",
	returnType,
	handler,
	params: params.map((p) => ({ name: p, type: "string" })),
});

/** Patterns are JavaScript's, which rejects RE2 inline flags such as (?i); the library has no case-insensitive match or regex replace. */
function baseEnvironment(id: string): Environment {
	const env = new Environment()
		.registerFunction("truthy(string): bool", (v: string) => truthy(v.trim()))
		.registerFunction("website(string): string", (v: string) => website(v) ?? "")
		.registerFunction("phone(string, string): string", (raw: string, country: string) =>
			country === "33" ? (phoneFR(raw) ?? "") : "",
		)
		.registerFunction("mobile(string): bool", (v: string) => mobileFR(v))
		.registerFunction(
			receiver("imatches", "bool", ["pattern"], (s, re) => new RegExp(re, "i").test(s)),
		)
		.registerFunction(
			receiver("remove", "string", ["pattern"], (s, re) => s.replace(new RegExp(re, "g"), "")),
		)
		.registerFunction(
			receiver("replace", "string", ["from", "to"], (s, from, to) => s.replaceAll(from, to)),
		);
	const [country, kind] = id.split(":");
	for (const [signature, handler] of COUNTRIES[country]?.celFunctions[kind] ?? [])
		env.registerFunction(`${country.toLowerCase()}_${kind}_${signature}`, handler);
	return env;
}

/** The names a rule may read: the declared inputs, `rows` for a grouped record, and each `let` once checked. */
export class Scope {
	readonly #env: Environment;

	constructor(id: string, inputs: Iterable<string>, grouped: boolean) {
		this.#env = baseEnvironment(id);
		for (const name of inputs) this.#env.registerVariable(name, "string");
		if (grouped) this.#env.registerVariable("rows", "list<map<string, string>>");
	}

	declare(name: string, type: string): void {
		this.#env.registerVariable(name, type);
	}

	check(source: string): Checked {
		const result = this.#env.check(source);
		if (!result.valid) {
			return { ok: false, error: result.error?.message.split("\n")[0] ?? "invalid expression" };
		}
		const parsed = this.#env.parse(source);
		const names = new Set<string>();
		namesIn(parsed.ast, names);
		return {
			ok: true,
			type: String(result.type),
			run: (context) => parsed(context),
			names,
		};
	}
}
