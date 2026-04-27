export type SpineDigestOperation =
  | "digest-epub"
  | "digest-markdown"
  | "digest-text-stream"
  | "digest-txt";

export interface SerialDiscoveryItem {
  readonly id: number;
  readonly fragments?: number | undefined;
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

export type SpineDigestProgressEventType = SpineDigestProgressEvent["type"];

export type SpineDigestProgressEvent =
  | SerialsDiscoveredEvent
  | SerialProgressEvent
  | DigestProgressEvent;

export type SpineDigestProgressCallback = (
  event: SpineDigestProgressEvent,
) => void | Promise<void>;
