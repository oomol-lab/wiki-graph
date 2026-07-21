import type { WikimatchTextRange } from "../../external/wikimatch/index.js";

export interface WikilinkMention {
  readonly id: string;
  readonly qid?: string;
  readonly range: WikimatchTextRange;
  readonly surface?: string;
}

export interface WikilinkEvidenceWindow {
  readonly baseOffset: number;
  readonly mentions: readonly WikilinkMention[];
  readonly range: WikimatchTextRange;
  readonly text: string;
}

export interface BuildWikilinkEvidenceWindowsOptions {
  readonly maxEvidenceDistance: number;
  readonly mentions: readonly WikilinkMention[];
  readonly text: string;
  readonly windowLength: number;
}
