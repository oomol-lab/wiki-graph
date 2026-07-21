import { getLogger } from "../common/logging.js";

import type {
  DigestProgressEvent,
  SerialProgressEvent,
  WikiGraphOperation,
  WikiGraphProgressCallback,
  WikiGraphProgressEvent,
} from "./types.js";

export class ProgressReporter {
  readonly #callback: WikiGraphProgressCallback | undefined;
  readonly #operation: WikiGraphOperation;

  public constructor(
    operation: WikiGraphOperation,
    callback?: WikiGraphProgressCallback,
  ) {
    this.#callback = callback;
    this.#operation = operation;
  }

  public async emit(event: WikiGraphProgressEvent): Promise<void> {
    getLogger({
      component: "progress",
      eventType: event.type,
      operation: this.#operation,
      ...buildLogBindings(event),
    }).info(buildLogMessage(event));

    if (this.#callback === undefined) {
      return;
    }

    try {
      await this.#callback(event);
    } catch (error) {
      getLogger({
        component: "progress",
        operation: this.#operation,
      }).warn(
        {
          error:
            error instanceof Error
              ? { message: error.message, name: error.name }
              : String(error),
        },
        "Progress callback failed",
      );
    }
  }
}

export function createProgressReporter(
  operation: WikiGraphOperation,
  callback?: WikiGraphProgressCallback,
): ProgressReporter {
  return new ProgressReporter(operation, callback);
}

function buildLogBindings(
  event: WikiGraphProgressEvent,
): Record<string, number> {
  switch (event.type) {
    case "serials-discovered":
      return {
        available: Number(event.available),
        serials: event.serials.length,
        totalFragments: event.serials.reduce(
          (sum, serial) => sum + (serial.fragments ?? 0),
          0,
        ),
        totalWords: event.serials.reduce(
          (sum, serial) => sum + serial.words,
          0,
        ),
      } satisfies Record<string, number>;
    case "serial-progress":
      return {
        completedFragments: event.completedFragments,
        completedWords: event.completedWords,
        id: event.id,
      } satisfies Record<keyof Omit<SerialProgressEvent, "type">, number>;
    case "digest-progress":
      return {
        completedWords: event.completedWords,
        totalWords: event.totalWords,
      } satisfies Record<keyof Omit<DigestProgressEvent, "type">, number>;
  }
}

function buildLogMessage(event: WikiGraphProgressEvent): string {
  switch (event.type) {
    case "serials-discovered":
      return event.available
        ? `Discovered ${event.serials.length} serials`
        : "Serial discovery unavailable";
    case "serial-progress":
      return `Serial ${event.id} progressed`;
    case "digest-progress":
      return "Digest progressed";
  }
}
