import {
  clearLocalConfigSection,
  deleteLocalConfigValue,
  maskLocalConfigSection,
  putLocalConfigValue,
  readLocalConfigSection,
  replaceLocalConfigSection,
  type LocalConfigObject,
  type LocalConfigSection,
} from "./local-config.js";
import type { WikiGraphJobRuntime } from "./jobs.js";

export class WikiGraphConfigManager {
  readonly #runtime: WikiGraphJobRuntime;

  public constructor(runtime: WikiGraphJobRuntime) {
    this.#runtime = runtime;
  }

  public async get(
    section: LocalConfigSection,
    options: { readonly maskSecrets?: boolean } = {},
  ): Promise<LocalConfigObject> {
    const value = await this.#runtime.run(
      async () => await readLocalConfigSection(section),
    );
    return options.maskSecrets === true
      ? maskLocalConfigSection(section, value)
      : value;
  }

  public async replace(
    section: LocalConfigSection,
    value: LocalConfigObject,
  ): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await replaceLocalConfigSection(section, value),
    );
  }

  public async put(
    section: LocalConfigSection,
    key: string,
    value: unknown,
  ): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await putLocalConfigValue(section, key, value),
    );
  }

  public async delete(
    section: LocalConfigSection,
    key: string,
  ): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await deleteLocalConfigValue(section, key),
    );
  }

  public async clear(section: LocalConfigSection): Promise<LocalConfigObject> {
    return await this.#runtime.run(
      async () => await clearLocalConfigSection(section),
    );
  }
}
