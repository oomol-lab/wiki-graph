export type WikiGraphOperation =
  | "digest-epub"
  | "digest-markdown"
  | "digest-text-stream"
  | "digest-txt";

export interface SerialDiscoveryItem {
  readonly id: number;
  readonly fragments?: number | undefined;
  readonly title?: string | undefined;
  readonly words: number;
}

export interface SerialsDiscoveredEvent {
  readonly type: "serials-discovered";
  readonly available: boolean;
  readonly serials: readonly SerialDiscoveryItem[];
}

export interface SerialProgressEvent {
  readonly type: "serial-progress";
  readonly id: number;
  readonly completedWords: number;
  readonly completedFragments: number;
}

export interface DigestProgressEvent {
  readonly type: "digest-progress";
  readonly completedWords: number;
  readonly totalWords: number;
}

export type WikiGraphProgressEventType = WikiGraphProgressEvent["type"];

export type WikiGraphProgressEvent =
  | SerialsDiscoveredEvent
  | SerialProgressEvent
  | DigestProgressEvent;

export type WikiGraphProgressCallback = (
  event: WikiGraphProgressEvent,
) => void | Promise<void>;
