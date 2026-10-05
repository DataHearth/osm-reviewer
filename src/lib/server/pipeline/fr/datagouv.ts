import { getJson } from "../http";
import { PipelineError } from "../types";

const DATAGOUV_DATASET = /^https?:\/\/(www\.)?data\.gouv\.fr\/api\/1\/datasets\//;

const LICENCES: Record<string, string> = {
	"fr-lo": "Licence Ouverte 1.0",
	lov2: "Licence Ouverte 2.0",
	"odc-odbl": "ODbL",
	"odc-by": "ODC-BY",
	"cc-by": "CC BY",
	"cc-by-sa": "CC BY-SA",
	"cc-zero": "CC0",
};

interface DatagouvResource {
	format?: string;
	url?: string;
	title?: string;
	last_modified?: string;
	type?: string;
}

/**
 * The file's URL carries its publication date and changes with every publish, so the
 * stable thing is the dataset page: its CSV resources are listed there. The consolidated
 * one wins when a dataset offers several, then the most recently modified.
 */
export function pickResource(resources: DatagouvResource[]): DatagouvResource | undefined {
	// IRVE also publishes "Documentation sur la consolidation" as a CSV, newer than the data
	// and with the same word in its title; only "main" resources are the dataset itself.
	const csv = resources.filter(
		(r) => r.url && (r.format ?? "").toLowerCase() === "csv" && (r.type ?? "main") === "main",
	);
	const score = (r: DatagouvResource) => (/consolid/i.test(r.title ?? "") ? 1 : 0);
	return csv.sort(
		(a, b) => score(b) - score(a) || (b.last_modified ?? "").localeCompare(a.last_modified ?? ""),
	)[0];
}

/** The file a data.gouv.fr dataset page currently publishes, or null for any other endpoint. */
export async function datasetFile(
	endpoint: string,
	headers: Record<string, string>,
): Promise<{ url: string; licence?: string } | null> {
	if (!DATAGOUV_DATASET.test(endpoint)) return null;
	const meta = await getJson<{ resources?: DatagouvResource[]; license?: string }>(endpoint, {
		headers,
	});
	const file = pickResource(meta.resources ?? []);
	if (!file?.url) throw new PipelineError("data.gouv.fr: the dataset lists no CSV resource");
	return { url: file.url, licence: meta.license ? LICENCES[meta.license] : undefined };
}
