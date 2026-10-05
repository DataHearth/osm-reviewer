// Usage: pnpm exec node scripts/audit/taginfo.mjs
//
// Lists the keys, and the values of keys with few values, that undecided candidates would
// write and that France's taginfo counts fewer than RARE times, with the world's count beside
// it. A rare tag is not a wrong one: this is a list to read, not a gate.
import path from "node:path";
import Database from "better-sqlite3";

const FRANCE = "https://taginfo.geofabrik.de/europe:france/api/4";
const WORLD = "https://taginfo.openstreetmap.org/api/4";
const RARE = 10;
// A key's values are a vocabulary when it has few distinct values per use (`fee`, `access`,
// `school:FR`, all under 0.001 in France), or few at all and still repeated
// (`social_facility:for`, 0.013); names and free text (`network` 0.015 but 4 500 values,
// `operator:phone` few but 0.06, `phone` 0.9) have mostly rare values. Numbers and places are
// left out whatever their key: a count is rare for being large, a commune for being small.
const isVocabulary = ({ count, values }) =>
	values / count < 0.005 || (values < 500 && values / count < 0.05);
const NOT_VOCABULARY = (k, v) => /^\d/.test(v) || k.startsWith("addr:");

const db = new Database(
	process.env.DATABASE_PATH ?? path.join(import.meta.dirname, "../../data/osm-reviewer.db"),
	{ readonly: true },
);
const rows = db
	.prepare(
		`select t.k, t.v, t.candidate_id id from candidate_tags t
		where t.op != 'del' and not exists (select 1 from candidate_decisions d where d.candidate_id = t.candidate_id)`,
	)
	.all();

const proposed = new Map();
for (const { k, v, id } of rows) {
	const values = proposed.get(k) ?? proposed.set(k, new Map()).get(k);
	values.set(v, [...(values.get(v) ?? []), id]);
}

async function stats(base, what, params) {
	const res = await fetch(`${base}/${what}/stats?${new URLSearchParams(params)}`, {
		headers: { "user-agent": "osm-reviewer audit (scripts/audit/taginfo.mjs)" },
	});
	if (!res.ok) throw new Error(`${res.url}: ${res.status}`);
	return (await res.json()).data.find((d) => d.type === "all") ?? { count: 0, values: 0 };
}

const example = (ids) => `${ids.length} candidate(s), e.g. /review?id=${ids[0]}`;
const lines = [];
for (const [k, values] of [...proposed].sort(([a], [b]) => a.localeCompare(b))) {
	const key = await stats(FRANCE, "key", { key: k });
	if (key.count < RARE) {
		const world = await stats(WORLD, "key", { key: k });
		lines.push(
			`key  ${k}  FR ${key.count}  world ${world.count}  ${example([...values.values()].flat())}`,
		);
		continue;
	}
	if (!isVocabulary(key)) continue;
	for (const [v, ids] of values) {
		if (NOT_VOCABULARY(k, v)) continue;
		const tag = await stats(FRANCE, "tag", { key: k, value: v });
		if (tag.count >= RARE) continue;
		const world = await stats(WORLD, "tag", { key: k, value: v });
		lines.push(`tag  ${k}=${v}  FR ${tag.count}  world ${world.count}  ${example(ids)}`);
	}
}
console.log(
	`${proposed.size} keys over ${new Set(rows.map((r) => r.id)).size} undecided candidates`,
);
console.log(lines.join("\n") || "nothing rare");
