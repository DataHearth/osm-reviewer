import { and, eq } from "drizzle-orm";
import { llm } from "$lib/server/config";
import type { Db } from "$lib/server/db/client";
import * as t from "$lib/server/db/schema";
import { askJson, type ModelConfig, modelLabel } from "./llm";
import { mappingFor, programFor, renamingFor } from "./mapping/files";
import {
	ANSWER_JSON_SCHEMA,
	answerSchema,
	type ColumnRenaming,
	checkAnswer,
	MAX_COLUMNS,
	nativeColumns,
	RENAME_SYSTEM,
	renameMessage,
} from "./mapping/rename";
import type { Preset } from "./preset";
import { presetFor, presetReader, type Reader, readerFor } from "./reader";
import { translated } from "./translate";
import { PipelineError, type Row } from "./types";

/** Rows the model is shown and the value checks run over. */
export const SAMPLE_ROWS = 20;

const MORE_PROBLEMS = 3;

export const columnsOf = (rows: Row[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

const within = (columns: Iterable<string>, known: ReadonlySet<string>) =>
	[...columns].every((c) => known.has(c));

const sameColumns = (columns: string[], listed: string[]) =>
	columns.length === listed.length && within(columns, new Set(listed));

export interface Resolves {
	resolve(sample: Row[]): Promise<Reader>;
	/** Notes a row of the read beyond its sample, which may carry a column the sample did not. */
	late(row: Row): void;
	/** The column of a dataset with these fields that holds the record's key, whether or not the fields are all known. */
	keyColumn(columns: string[]): string | null;
}

/** For a read with no database behind it: the preset the source names or its columns give, no renaming. */
export const unaided = (source: {
	extractor: "deterministic" | "model";
	preset: string | null;
}): Resolves => ({
	resolve: async (sample: Row[]) => readerFor(source, columnsOf(sample)),
	late: () => {},
	keyColumn: (columns: string[]) => readerFor(source, columns).keyField,
});

type Source = {
	id: string;
	extractor: "deterministic" | "model";
	preset: string | null;
	renameRequestedAt: Date | null;
	renamingUsed?: "shipped" | "stored" | null;
	lateColumns?: string[];
};

type Basis = "shipped" | "stored";

const PAST_SAMPLE_SHOWN = 5;

/**
 * Settles which columns of a source are which inputs of its mapping, at the point a run first
 * meets the data. In this order: columns all inside the shipped renaming's are read through it;
 * exactly the list the stored renaming was made for are read through that; anything else, or a
 * pending "rename again" where the shipped renaming does not cover the columns, asks the model.
 * The model's answer is checked and stored before a record is read through it, and one that
 * fails its checks fails the run. A column that turns up only past the sample is left out of
 * this run and asked about at the next.
 */
export class ReaderResolver implements Resolves {
	#last: { covers: ReadonlySet<string>; reader: Reader; basis: Basis | null } | null = null;
	#failed: unknown = null;
	#asked: boolean;
	#used: Basis | null;
	#extra: string[];
	#late = new Set<string>();

	constructor(
		private readonly db: Db,
		private readonly source: Source,
		/** Called with the sentence the run's message carries when columns were renamed. */
		private readonly onRenamed: (message: string) => void,
		private readonly model: ModelConfig = llm,
	) {
		this.#asked = source.renameRequestedAt !== null;
		this.#used = source.renamingUsed ?? null;
		this.#extra = source.lateColumns ?? [];
	}

	#stored() {
		return this.db
			.select()
			.from(t.sourceRenamings)
			.where(eq(t.sourceRenamings.sourceId, this.source.id))
			.get();
	}

	#columnsOf(sample: Row[]) {
		return [...new Set([...columnsOf(sample), ...this.#extra])];
	}

	#through(base: Preset, renaming: ColumnRenaming): Preset {
		return translated(
			base.withProgram(programFor(base.source, { overrides: false })),
			nativeColumns(renamingFor(base.source), renaming),
		);
	}

	/** The reader these columns already have, without asking anyone; null where only the model can say. */
	#known(
		read: string[],
		columns: string[],
	): { reader: Reader; basis: Basis; covers: ReadonlySet<string> } | null {
		const base = presetFor(this.source, columns);
		const shipped = new Set(renamingFor(base.source).columns);
		if (within(read, shipped))
			return { reader: presetReader(base), basis: "shipped", covers: shipped };
		const stored = this.#stored();
		if (!this.#asked && stored?.mapping === base.mapping && sameColumns(columns, stored.columns))
			return {
				reader: presetReader(this.#through(base, stored.renaming)),
				basis: "stored",
				covers: new Set(stored.columns),
			};
		return null;
	}

	keyColumn(columns: string[]): string | null {
		if (this.source.extractor === "model") return null;
		const base = presetFor(this.source, columns);
		if (within(columns, new Set(renamingFor(base.source).columns))) return base.keyField;
		const stored = this.#stored();
		if (this.#asked || stored?.mapping !== base.mapping || !sameColumns(columns, stored.columns))
			return base.keyField;
		const natives = nativeColumns(renamingFor(base.source), stored.renaming);
		return columns.find((c) => natives.get(c) === base.keyField) ?? base.keyField;
	}

	late(row: Row) {
		const covers = this.#last?.covers;
		if (!covers) return;
		for (const column in row) if (!covers.has(column)) this.#late.add(column);
	}

	/** Called when a read is over: columns met past the sample are named in the run's message and asked about at the next. */
	finish() {
		if (this.#late.size === 0) return;
		const names = [...this.#late];
		this.#late.clear();
		const shown = `${names.slice(0, PAST_SAMPLE_SHOWN).join(", ")}${names.length > PAST_SAMPLE_SHOWN ? ", …" : ""}`;
		const appeared = `${names.length} ${names.length === 1 ? "column appeared" : "columns appeared"} past the sample: ${shown}`;
		if (this.#last?.basis === "shipped") {
			this.onRenamed(`${appeared} — left out, the shipped renaming does not cover them`);
			return;
		}
		if (!modelLabel(this.model)) {
			this.onRenamed(`${appeared} — left out, and no model is configured to rename them`);
			return;
		}
		this.db
			.update(t.sources)
			.set({ lateColumns: [...new Set([...this.#extra, ...names])], renameRequestedAt: new Date() })
			.where(eq(t.sources.id, this.source.id))
			.run();
		this.onRenamed(`${appeared} — renamed on the next run`);
	}

	#settle(basis: Basis) {
		if (this.#used !== basis) {
			this.db
				.update(t.sources)
				.set({ renamingUsed: basis })
				.where(eq(t.sources.id, this.source.id))
				.run();
			this.#used = basis;
		}
		if (basis === "shipped") this.#clearRequest();
	}

	/** Clears only the request this run started with: one made since is for the next run. */
	#clearRequest(tx: Pick<Db, "update"> = this.db) {
		const at = this.source.renameRequestedAt;
		if (!at) return;
		tx.update(t.sources)
			.set({ renameRequestedAt: null })
			.where(and(eq(t.sources.id, this.source.id), eq(t.sources.renameRequestedAt, at)))
			.run();
	}

	/** The reader for rows with these columns, asking the model first where nothing known covers them. */
	async resolve(sample: Row[]): Promise<Reader> {
		if (this.source.extractor === "model") return readerFor(this.source, []);
		if (this.#failed) throw this.#failed;
		if (this.#last) return this.#last.reader;
		const columns = this.#columnsOf(sample);
		try {
			const known = this.#known(columnsOf(sample), columns);
			if (known) this.#settle(known.basis);
			const made = known ?? (await this.#rename(columns, sample));
			this.#last = {
				covers: made.covers,
				reader: made.reader,
				basis: known?.basis ?? null,
			};
			return made.reader;
		} catch (err) {
			this.#failed = err;
			throw err;
		}
	}

	async #rename(columns: string[], sample: Row[]) {
		const base = presetFor(this.source, columns);
		const label = modelLabel(this.model);
		if (!label)
			throw new PipelineError(
				`${base.mapping}: ${this.#asked ? "columns were asked to be renamed again" : `columns the app does not know (${columns.slice(0, 4).join(", ")}${columns.length > 4 ? ", …" : ""})`}, and no model is configured to rename them: set LLM_PROVIDER and LLM_MODEL`,
			);
		if (columns.length > MAX_COLUMNS)
			throw new PipelineError(
				`${base.mapping}: the file has ${columns.length} columns, more than the ${MAX_COLUMNS} the model can rename`,
			);
		const ctx = {
			mapping: mappingFor(base.mapping),
			shipped: renamingFor(base.source),
			columns,
			sample: sample.slice(0, SAMPLE_ROWS),
		};
		let answer: ReturnType<typeof answerSchema.safeParse>;
		try {
			answer = answerSchema.safeParse(
				await askJson(this.model, {
					system: RENAME_SYSTEM,
					user: renameMessage(ctx),
					schema: ANSWER_JSON_SCHEMA,
					name: "column_renaming",
					maxTokens: 8192,
				}),
			);
		} catch (err) {
			throw new PipelineError(
				`renaming columns for ${base.mapping}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (!answer.success)
			throw new PipelineError(
				`renaming columns for ${base.mapping}: the model's answer does not fit the schema`,
			);
		const checked = checkAnswer(answer.data, ctx);
		if ("problems" in checked)
			throw new PipelineError(
				`the model's column renaming for ${base.mapping} was refused and nothing stored: ${checked.problems.slice(0, MORE_PROBLEMS).join("; ")}${checked.problems.length > MORE_PROBLEMS ? ` (+${checked.problems.length - MORE_PROBLEMS} more)` : ""}`,
			);

		const { renaming } = checked;
		const before = this.#stored();
		const values = {
			mapping: base.mapping,
			columns,
			renaming,
			model: label,
			madeAt: new Date(),
		};
		this.db.transaction((tx) => {
			tx.insert(t.sourceRenamings)
				.values({ sourceId: this.source.id, ...values })
				.onConflictDoUpdate({ target: t.sourceRenamings.sourceId, set: values })
				.run();
			tx.update(t.sources)
				.set({ renamingUsed: "stored" })
				.where(eq(t.sources.id, this.source.id))
				.run();
			this.#clearRequest(tx);
		});
		this.#asked = false;
		this.#used = "stored";
		this.onRenamed(
			`columns renamed${before ? " again" : ""} by ${label} for ${base.mapping}: ${Object.keys(renaming.rename).length} renamed, ${Object.keys(renaming.steps).length} read by a step, ${Object.keys(renaming.ignored).length} ignored`,
		);
		return {
			reader: presetReader(this.#through(base, renaming)),
			covers: new Set(columns) as ReadonlySet<string>,
		};
	}
}
