import { writeTextToStdout } from "../support/index.js";
import { formatCLIJSONLine } from "../support/index.js";

export interface ProgressCounter {
  readonly done: number;
  readonly name: string;
  readonly total: number;
  readonly unit: string;
}

export interface ProgressMetric {
  readonly name: string;
  readonly value: number;
}

export interface ProgressMetricGroup {
  readonly metrics: readonly ProgressMetric[];
  readonly name: string;
}

export type ProgressOutputEvent =
  | {
      readonly json: unknown;
      readonly kind: "lifecycle";
      readonly text: string;
    }
  | {
      readonly counters?: readonly ProgressCounter[];
      readonly json: unknown;
      readonly kind: "status";
      readonly metricGroups?: readonly ProgressMetricGroup[];
      readonly phase: string;
    };

export class ProgressOutputWriter {
  readonly #jsonl: boolean;
  readonly #throttleMs: number;
  readonly #tty: boolean;
  #lastStatusAt: number | undefined;
  #lastStatusKey: string | undefined;
  #statusLineOpen = false;

  public constructor(input: {
    readonly jsonl: boolean;
    readonly throttleMs: number;
    readonly tty?: boolean;
  }) {
    this.#jsonl = input.jsonl;
    this.#throttleMs = input.throttleMs;
    this.#tty = input.tty ?? process.stdout.isTTY === true;
  }

  public async write(event: ProgressOutputEvent): Promise<void> {
    if (event.kind === "status" && !this.#shouldWriteStatus(event)) {
      return;
    }

    if (this.#jsonl) {
      await this.#writeLine(formatCLIJSONLine(event.json));
      return;
    }

    if (event.kind === "status") {
      await this.#writeStatus(formatStatusText(event));
      return;
    }

    await this.#writeLifecycle(event.text);
  }

  async #writeLifecycle(text: string): Promise<void> {
    if (this.#tty && this.#statusLineOpen) {
      await writeTextToStdout("\n");
      this.#statusLineOpen = false;
    }

    await this.#writeLine(`${text}\n`);
  }

  async #writeLine(text: string): Promise<void> {
    await writeTextToStdout(text);
  }

  async #writeStatus(text: string): Promise<void> {
    if (this.#tty) {
      await writeTextToStdout(`\r\x1B[2K${text}`);
      this.#statusLineOpen = true;
      return;
    }

    await this.#writeLine(`${text}\n`);
  }

  #shouldWriteStatus(
    event: Extract<ProgressOutputEvent, { readonly kind: "status" }>,
  ): boolean {
    const key = event.phase;
    const completed = isStatusComplete(event);
    const now = Date.now();
    const elapsed =
      this.#lastStatusAt === undefined
        ? Number.POSITIVE_INFINITY
        : now - this.#lastStatusAt;

    if (
      key !== this.#lastStatusKey ||
      completed ||
      this.#lastStatusAt === undefined ||
      elapsed >= this.#throttleMs
    ) {
      this.#lastStatusAt = now;
      this.#lastStatusKey = key;
      return true;
    }

    return false;
  }
}

export function formatStatusText(input: {
  readonly counters?: readonly ProgressCounter[];
  readonly metricGroups?: readonly ProgressMetricGroup[];
  readonly phase: string;
}): string {
  const counters = input.counters ?? [];
  const counterText =
    counters.length === 0
      ? ""
      : ` ${counters.map(formatCounterText).join(" | ")}`;
  const metricText = formatMetricGroupsText(input.metricGroups);

  return `${input.phase}${counterText}${metricText === "" ? "" : ` ${metricText}`}`;
}

function formatCounterText(counter: ProgressCounter): string {
  if (counter.name === counter.unit) {
    return `${counter.name} ${counter.done}/${counter.total}`;
  }

  return `${counter.name} ${counter.done}/${counter.total} ${counter.unit}`;
}

function formatMetricGroupsText(
  metricGroups: readonly ProgressMetricGroup[] | undefined,
): string {
  if (metricGroups === undefined) {
    return "";
  }

  const parts = metricGroups.flatMap((group) => {
    const metrics = group.metrics.map(
      (metric) => `${metric.name}: ${metric.value}`,
    );

    return metrics.length === 0
      ? []
      : [`[${group.name} ${metrics.join(" / ")}]`];
  });

  return parts.join(" ");
}

function isStatusComplete(input: {
  readonly counters?: readonly ProgressCounter[];
}): boolean {
  const counters = input.counters ?? [];

  return (
    counters.length > 0 &&
    counters.every(
      (counter) => counter.total > 0 && counter.done >= counter.total,
    )
  );
}
