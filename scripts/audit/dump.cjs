const fs = require("node:fs");
const path = require("node:path");
// Usage: node scripts/audit/dump.cjs <outdir> <area_id>. In a jj workspace, data/ is not
// copied over: point DATABASE_PATH at the main checkout's file.
const D = require("better-sqlite3")(
	process.env.DATABASE_PATH ?? path.join(__dirname, "../../data/osm-reviewer.db"),
	{ readonly: true },
);
const out = process.argv[2];
const groups = [
	["irve-new", "irve", "new", 14],
	["irve-update", "irve", "update", 14],
	["education-new", "education", "new", 14],
	["education-update", "education", "update", 14],
];
const tags = D.prepare("select * from candidate_tags where candidate_id = ? order by position");
const ev = D.prepare("select * from evidence where tag_id = ?");
const parts = D.prepare(
	"select text, mark from evidence_parts where evidence_id = ? order by position",
);
const nearby = D.prepare(
	"select label from candidate_nearby where candidate_id = ? order by position",
);
for (const [name, src, type, n] of groups) {
	const rows = D.prepare(`select c.*, a.name area from candidates c join areas a on a.id = c.area_id
    where c.area_id = ? and c.source_id = ? and c.type = ? and not exists (select 1 from candidate_decisions d where d.candidate_id = c.id)
    order by random() limit ?`).all(process.argv[3], src, type, n);
	const dump = rows.map((c) => ({
		id: c.id,
		reviewUrl: `http://localhost:5173/review?id=${c.id}`,
		area: c.area,
		type: c.type,
		osmId: c.osm_id,
		baseVersion: c.base_version ?? c.version,
		name: c.name,
		addr: c.addr,
		lat: c.lat,
		lon: c.lon,
		conf: c.conf,
		sourceRecordKey: c.source_record_key,
		warning: c.warning,
		proposedTags: tags.all(c.id).map((t) => {
			const e = ev.get(t.id);
			return {
				op: t.op,
				k: t.k,
				v: t.v,
				was: t.was,
				conf: t.conf,
				invalid: !!t.invalid,
				invalidMsg: t.invalid_msg,
				evidence: e
					? {
							path: e.path,
							kind: e.kind,
							conf: e.conf,
							quote: parts
								.all(e.id)
								.map((p) => p.text)
								.join(""),
						}
					: null,
			};
		}),
		osmTagsLeftUnchanged: JSON.parse(c.unchanged_tags),
		nearbyLabels: nearby.all(c.id).map((r) => r.label),
		sourceRows: c.record ? (JSON.parse(c.record).rows ?? JSON.parse(c.record)) : null,
	}));
	fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(dump, null, 1));
	console.log(name, dump.length);
}
