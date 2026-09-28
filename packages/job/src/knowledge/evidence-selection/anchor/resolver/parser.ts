import { normalizeText, splitTextIntoSentences } from "../../text.js";

import type { AnchorSpec } from "./types.js";

export function parseRawAnchor(
  value: unknown,
): readonly [anchor: AnchorSpec | undefined, error: string | undefined] {
  if (value === undefined || value === null) {
    return [undefined, "anchor is required"];
  }

  if (typeof value === "string") {
    const stripped = value.trim();

    if (stripped === "") {
      return [undefined, "anchor string is empty"];
    }

    if (stripped.includes("...")) {
      const parts = stripped
        .split("...")
        .map((part) => part.trim())
        .filter((part) => part !== "");

      if (parts.length >= 2) {
        const head = parts[0];
        const tail = parts[parts.length - 1];

        if (head === undefined || tail === undefined) {
          return [undefined, "anchor string is empty"];
        }

        return [
          {
            head,
            mode: "head_tail",
            tail,
          },
          undefined,
        ];
      }
    }

    return [{ mode: "full", text: stripped }, undefined];
  }

  if (typeof value !== "object") {
    return [undefined, `expected string or object, got ${typeof value}`];
  }

  const rawValue = value as Record<string, unknown>;
  const mode =
    rawValue.mode === "head_tail" || rawValue.head !== undefined
      ? "head_tail"
      : "full";

  if (mode === "full") {
    const text = typeof rawValue.text === "string" ? rawValue.text.trim() : "";

    if (text === "") {
      return [undefined, "full anchor requires non-empty 'text'"];
    }

    return [{ mode: "full", text }, undefined];
  }

  const head = typeof rawValue.head === "string" ? rawValue.head.trim() : "";
  const tail = typeof rawValue.tail === "string" ? rawValue.tail.trim() : "";

  if (head !== "" && tail === "") {
    return [{ mode: "full", text: head }, undefined];
  }

  if (head === "" && tail !== "") {
    return [{ mode: "full", text: tail }, undefined];
  }

  if (head === "" || tail === "") {
    return [undefined, "head_tail anchor requires non-empty 'head' and 'tail'"];
  }

  return [{ head, mode: "head_tail", tail }, undefined];
}

export function normalizeAnchor(
  anchor: AnchorSpec | undefined,
  fieldName: string,
): AnchorSpec | undefined {
  if (anchor === undefined) {
    return undefined;
  }

  if (anchor.mode === "head_tail") {
    const boundaryText =
      fieldName === "end_anchor"
        ? selectBoundarySentence(anchor.tail ?? "", "end_anchor")
        : selectBoundarySentence(anchor.head ?? "", "start_anchor");

    return boundaryText === ""
      ? undefined
      : {
          mode: "full",
          text: boundaryText,
        };
  }

  const normalizedText = selectBoundarySentence(anchor.text ?? "", fieldName);

  return {
    mode: "full",
    text: normalizedText,
  };
}

export function anchorLength(anchor: AnchorSpec): number {
  if (anchor.mode === "head_tail") {
    return (
      normalizeText(anchor.head ?? "").length +
      normalizeText(anchor.tail ?? "").length
    );
  }

  return normalizeText(anchor.text ?? "").length;
}

function selectBoundarySentence(text: string, fieldName: string): string {
  const sentences = splitTextIntoSentences(text);

  if (sentences.length <= 1) {
    return text.trim();
  }

  return fieldName === "end_anchor"
    ? (sentences[sentences.length - 1] ?? text.trim())
    : (sentences[0] ?? text.trim());
}
