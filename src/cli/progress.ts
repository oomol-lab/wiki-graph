import { clearLine, cursorTo, moveCursor } from "readline";

import type {
  SpineDigestProgressCallback,
  SpineDigestProgressEvent,
} from "../index.js";

interface SerialState {
  completedFragments: number;
  completedWords: number;
  fragments?: number;
  title?: string;
  words?: number;
}

export interface CLIProgressRenderer {
  readonly onProgress?: SpineDigestProgressCallback;
  stop(): Promise<void>;
}

export function createCLIProgressRenderer(input: {
  readonly enabled: boolean;
  readonly stream?: NodeJS.WriteStream;
}): CLIProgressRenderer {
  if (!input.enabled) {
    return {
      async stop() {},
    };
  }

  return new TerminalProgressRenderer(input.stream ?? process.stderr);
}

class TerminalProgressRenderer implements CLIProgressRenderer {
  readonly #stream: NodeJS.WriteStream;
  readonly #serials = new Map<number, SerialState>();
  #digest:
    | {
        completedWords: number;
        totalWords: number;
      }
    | undefined;
  #renderQueue: Promise<void> = Promise.resolve();
  #renderedLineCount = 0;
  #stopping = false;

  public constructor(stream: NodeJS.WriteStream) {
    this.#stream = stream;
  }

  public readonly onProgress: SpineDigestProgressCallback = async (event) => {
    if (this.#stopping) {
      return;
    }

    const renderTask = this.#renderQueue.catch(swallowRenderError).then(() => {
      this.#applyEvent(event);
      this.#render();
    });

    this.#renderQueue = renderTask;

    await renderTask;
  };

  public async stop(): Promise<void> {
    if (this.#stopping) {
      await this.#renderQueue.catch(swallowRenderError);
      return;
    }

    this.#stopping = true;

    const stopTask = this.#renderQueue.catch(swallowRenderError).then(() => {
      if (this.#renderedLineCount === 0) {
        return;
      }

      this.#stream.write("\n");
      this.#renderedLineCount = 0;
    });

    this.#renderQueue = stopTask;

    await stopTask;
  }

  #applyEvent(event: SpineDigestProgressEvent): void {
    switch (event.type) {
      case "serials-discovered":
        if (!event.available) {
          return;
        }

        for (const serial of event.serials) {
          this.#serials.set(serial.id, {
            completedFragments: 0,
            completedWords: 0,
            ...(serial.title === undefined ? {} : { title: serial.title }),
            words: serial.words,
            ...(serial.fragments === undefined
              ? {}
              : { fragments: serial.fragments }),
          });
        }
        return;
      case "serial-progress": {
        const serial = this.#serials.get(event.id) ?? {
          completedFragments: 0,
          completedWords: 0,
        };

        serial.completedFragments = event.completedFragments;
        serial.completedWords = event.completedWords;
        this.#serials.set(event.id, serial);
        return;
      }
      case "digest-progress":
        this.#digest = {
          completedWords: event.completedWords,
          totalWords: event.totalWords,
        };
        return;
    }
  }

  #render(): void {
    const lines = this.#buildLines();

    if (lines.length === 0) {
      return;
    }

    if (this.#renderedLineCount > 1) {
      moveCursor(this.#stream, 0, -(this.#renderedLineCount - 1));
    }

    const renderLineCount = Math.max(lines.length, this.#renderedLineCount);

    for (let index = 0; index < renderLineCount; index += 1) {
      cursorTo(this.#stream, 0);
      clearLine(this.#stream, 0);

      const line = lines[index];

      if (line !== undefined) {
        this.#stream.write(line);
      }

      if (index < renderLineCount - 1) {
        this.#stream.write("\n");
      }
    }

    this.#renderedLineCount = renderLineCount;
  }

  #buildLines(): string[] {
    const lines: string[] = [];
    const serials = [...this.#serials.entries()].sort(
      ([leftId], [rightId]) => leftId - rightId,
    );
    const discoveredSerials = serials.filter(
      (entry): entry is [number, SerialState & { words: number }] =>
        hasDiscoveryWords(entry[1]),
    );
    const totalSerialWords = discoveredSerials.reduce(
      (sum, [, serial]) => sum + serial.words,
      0,
    );
    const totalCompletedSerialWords = discoveredSerials.reduce(
      (sum, [, serial]) => sum + serial.completedWords,
      0,
    );
    const activeSerials = discoveredSerials.filter(
      ([, serial]) =>
        serial.completedWords > 0 && serial.completedWords < serial.words,
    );

    if (discoveredSerials.length > 0) {
      lines.push(
        `${formatStageLabel("Serial")}${renderBar(
          totalCompletedSerialWords,
          totalSerialWords,
        )} ${formatNumber(totalCompletedSerialWords)} / ${formatNumber(
          totalSerialWords,
        )} words`,
      );
    }

    if (this.#digest !== undefined) {
      lines.push(
        `${formatStageLabel("Digest")}${renderBar(
          this.#digest.completedWords,
          this.#digest.totalWords,
        )} ${formatNumber(this.#digest.completedWords)} / ${formatNumber(
          this.#digest.totalWords,
        )} words`,
      );
    }

    if (activeSerials.length > 0) {
      lines.push("-".repeat(24));
    }

    const wordsLabelWidth = activeSerials.reduce((width, [, serial]) => {
      return Math.max(
        width,
        buildWordsLabel(serial.completedWords, serial.words).length,
      );
    }, 0);

    for (const [serialId, serial] of activeSerials) {
      const wordsLabel = buildWordsLabel(serial.completedWords, serial.words);
      const fragmentsLabel = buildFragmentsLabel(
        serial.completedFragments,
        serial.fragments,
      );

      lines.push(buildSerialHeading(serialId, serial.title));
      lines.push(
        `${formatSerialDetailIndent()}${renderBar(
          serial.completedWords,
          serial.words,
        )} ${wordsLabel.padEnd(wordsLabelWidth)}${fragmentsLabel === undefined ? "" : ` (${fragmentsLabel})`}`,
      );
    }

    return lines;
  }
}

function swallowRenderError(): undefined {
  return undefined;
}

function hasDiscoveryWords(
  serial: SerialState,
): serial is SerialState & { words: number } {
  return serial.words !== undefined;
}

function formatStageLabel(label: string): string {
  return label.padEnd(8);
}

function buildSerialHeading(
  serialId: number,
  title: string | undefined,
): string {
  if (title === undefined) {
    return `#${serialId}`;
  }

  const sanitizedTitle = sanitizeSerialTitle(title);

  return sanitizedTitle === ""
    ? `#${serialId}`
    : `#${serialId} ${sanitizedTitle}`;
}

function formatSerialDetailIndent(): string {
  return " ".repeat(7);
}

function buildWordsLabel(completed: number, total: number): string {
  return `${formatNumber(completed)} / ${formatNumber(total)} words`;
}

function sanitizeSerialTitle(title: string): string {
  let sanitized = "";

  for (let index = 0; index < title.length; index += 1) {
    const current = title[index];

    if (current === "\u001B") {
      const next = title[index + 1];

      if (next === "[") {
        index = skipAnsiCSISequence(title, index + 2);
        continue;
      }

      if (next === "]") {
        index = skipAnsiOSCSequence(title, index + 2);
        continue;
      }

      continue;
    }

    if (current !== undefined && /\p{Cc}/u.test(current)) {
      continue;
    }

    sanitized += current ?? "";
  }

  return sanitized.trim();
}

function skipAnsiCSISequence(title: string, startIndex: number): number {
  for (let index = startIndex; index < title.length; index += 1) {
    const current = title[index];

    if (current === undefined) {
      return title.length;
    }

    if (current >= "@" && current <= "~") {
      return index;
    }
  }

  return title.length;
}

function skipAnsiOSCSequence(title: string, startIndex: number): number {
  for (let index = startIndex; index < title.length; index += 1) {
    const current = title[index];
    const next = title[index + 1];

    if (current === undefined) {
      return title.length;
    }

    if (current === "\u0007") {
      return index;
    }

    if (current === "\u001B" && next === "\\") {
      return index + 1;
    }
  }

  return title.length;
}

function buildFragmentsLabel(
  completed: number,
  total: number | undefined,
): string | undefined {
  if (total === undefined) {
    return undefined;
  }

  return `${formatNumber(completed)}/${formatNumber(total)} fragments`;
}

function renderBar(completed: number, total: number): string {
  const width = 12;
  const safeTotal = total <= 0 ? 1 : total;
  const ratio = Math.max(0, Math.min(1, completed / safeTotal));
  const filled = Math.round(ratio * width);

  return `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
