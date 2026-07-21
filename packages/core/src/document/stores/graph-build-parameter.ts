import { getOptionalString, getString } from "../database.js";
import type { Database } from "../database.js";
import type { GraphBuildParameterRecord } from "../types.js";
import { createHash } from "../../utils/hash.js";
import type { ReadonlyGraphBuildParameterStore } from "./types.js";

export class GraphBuildParameterStore implements ReadonlyGraphBuildParameterStore {
  readonly #database: Database;

  public constructor(database: Database) {
    this.#database = database;
  }

  public async save(input: {
    readonly language?: string;
    readonly prompt: string;
  }): Promise<GraphBuildParameterRecord> {
    const hash = createHash({
      language: input.language ?? null,
      prompt: input.prompt,
    });
    const createdAt = new Date().toISOString();

    await this.#database.run(
      `
        INSERT OR IGNORE INTO graph_build_parameters (
          hash, prompt, language, created_at
        )
        VALUES (?, ?, ?, ?)
      `,
      [hash, input.prompt, input.language ?? null, createdAt],
    );

    return (await this.getByHash(hash))!;
  }

  public async getByHash(
    hash: string,
  ): Promise<GraphBuildParameterRecord | undefined> {
    return await this.#database.queryOne(
      `
        SELECT hash, prompt, language, created_at
        FROM graph_build_parameters
        WHERE hash = ?
      `,
      [hash],
      (row) => {
        const language = getOptionalString(row, "language");

        return {
          createdAt: getString(row, "created_at"),
          hash: getString(row, "hash"),
          ...(language === undefined ? {} : { language }),
          prompt: getString(row, "prompt"),
        };
      },
    );
  }

  public async deleteUnreferenced(): Promise<void> {
    await this.#database.run(`
      DELETE FROM graph_build_parameters
      WHERE hash NOT IN (
        SELECT topology_parameter_hash
        FROM serial_states
        WHERE topology_parameter_hash IS NOT NULL
        UNION
        SELECT knowledge_graph_parameter_hash
        FROM serial_states
        WHERE knowledge_graph_parameter_hash IS NOT NULL
      )
    `);
  }
}
