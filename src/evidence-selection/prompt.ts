export const EVIDENCE_SELECTION_PROMPT_FRAGMENT = [
  "Evidence selection:",
  '- Return evidence as [{"sentence_id":"S1","quote":"exact short source quote"}].',
  "- evidence.quote is a locator for the source sentence, not a proof excerpt.",
  "- Choose the shortest exact quote that still uniquely identifies the intended sentence.",
  "- If the quote is too short, it may match multiple sentences; if it is too long, it may include unnecessary text or cross sentence boundaries.",
  "- Do not use a whole sentence by default.",
  "- evidence is an array. Use multiple items when the claim needs multiple source sentences.",
  "- A source sentence means exactly one displayed source line labeled S1, S2, S3, etc.",
  "- Each evidence item must point to exactly one source sentence.",
  "- Each evidence item must quote one continuous span from exactly one labeled source line, for example only from S2.",
  "- Never merge text from two labeled source lines into one evidence quote.",
  "- sentence_id must be one of the sentence IDs shown in the source context.",
  "- quote must be copied from the untagged original source sentence.",
  "- If the source context contains XML-like tags, do not copy the tags into quote; copy only the visible text.",
].join("\n");

export const EVIDENCE_SELECTION_JSON_SHAPE = [
  {
    quote: "exact short source quote copied from the selected sentence",
    sentence_id: "sentence id from the source context, such as S1",
  },
] as const;

export function formatEvidenceSelectionChoicePrompt(input: {
  readonly evidenceLabel: string;
  readonly generatedEvidence: unknown;
  readonly candidates: readonly {
    readonly nextText: string;
    readonly occurrenceId: string;
    readonly prevText: string;
    readonly score: number;
    readonly text: string;
  }[];
}): string {
  return [
    `Resolve only this evidence selection: ${input.evidenceLabel}.`,
    "The generated evidence did not match its sentence_id and quote confidently.",
    "Choose exactly one candidate occurrence ID from the list below.",
    'Return JSON only: {"choice":"S1"}',
    "",
    "Generated evidence:",
    JSON.stringify(input.generatedEvidence, null, 2),
    "",
    "Candidates:",
    input.candidates.map(formatChoiceCandidate).join("\n"),
  ].join("\n");
}

function formatChoiceCandidate(input: {
  readonly nextText: string;
  readonly occurrenceId: string;
  readonly prevText: string;
  readonly score: number;
  readonly text: string;
}): string {
  return [
    `${input.occurrenceId} score=${input.score.toFixed(3)}`,
    `prev: ${formatChoiceText(input.prevText)}`,
    `text: ${formatChoiceText(input.text)}`,
    `next: ${formatChoiceText(input.nextText)}`,
  ].join("\n");
}

function formatChoiceText(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();

  return collapsed === "" ? "(none)" : collapsed;
}
