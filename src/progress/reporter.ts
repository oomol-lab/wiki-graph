import { getLogger } from "../common/logging.js";

import type {
  DigestProgressEvent,
  SerialProgressEvent,
  SpineDigestOperation,
  SpineDigestProgressCallback,
  SpineDigestProgressEvent,
} from "./types.js";

export class ProgressReporter {
  readonly #callback: SpineDigestProgressCallback | undefined;
  readonly #operation: SpineDigestOperation;

  public constructor(
    operation: SpineDigestOperation,
    callback?: SpineDigestProgressCallback,
  ) {
    this.#callback = callback;
    this.#operation = operation;
  }

  public async emit(event: SpineDigestProgressEvent): Promise<void> {
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
  operation: SpineDigestOperation,
  callback?: SpineDigestProgressCallback,
): ProgressReporter {
  return new ProgressReporter(operation, callback);
}

function buildLogBindings(
  event: SpineDigestProgressEvent,
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

function buildLogMessage(event: SpineDigestProgressEvent): string {
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
