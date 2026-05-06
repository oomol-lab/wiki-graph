import { jsonrepair } from "jsonrepair";
import type { ZodError, core } from "zod";

export function extractJsonText(response: string): string {
  const withoutCodeFence = response.replace(
    /```(?:json)?\s*\n(.*?)\n```/gs,
    "$1",
  );
  const matchedArray = withoutCodeFence.match(/\[[\s\S]*\]/);
  const matchedObject = withoutCodeFence.match(/\{[\s\S]*\}/);

  if (
    matchedArray?.index !== undefined &&
    matchedArray[0] !== undefined &&
    (matchedObject?.index === undefined ||
      matchedArray.index < matchedObject.index)
  ) {
    return matchedArray[0];
  }

  if (matchedObject?.[0] !== undefined) {
    return matchedObject[0];
  }

  return withoutCodeFence.trim();
}

export function repairJsonText(jsonText: string): string {
  try {
    return jsonrepair(jsonText);
  } catch {
    return jsonText;
  }
}

export function buildSyntaxErrorMessage(error: SyntaxError): string {
  const lines = [
    "Your JSON has a syntax error.",
    `Error: ${error.message}`,
    "",
    "Common issues:",
    "- Trailing commas in arrays or objects",
    '- Unescaped quotes in strings, for example: "He said \\"hi\\""',
    '- Single quotes instead of double quotes, for example: {"key": "value"}',
    "- Missing commas between items",
    "",
    "Regenerate the complete and valid JSON directly. Do not add explanations or markdown fences.",
  ];

  return lines.join("\n");
}

export function buildMalformedJsonMessage(error: SyntaxError): string {
  const lines = [
    "Your previous reply looked like malformed JSON.",
    `Error: ${error.message}`,
    "",
    "Return complete and valid JSON directly.",
    "Do not answer conversationally.",
    "Do not add explanations or markdown fences.",
  ];

  return lines.join("\n");
}

export function buildNaturalLanguageMessage(): string {
  const lines = [
    "Your previous reply was plain natural language, not a JSON object or array.",
    "",
    "Do not apologize or explain.",
    "Do not answer conversationally.",
    "Return complete and valid JSON directly.",
  ];

  return lines.join("\n");
}

export function buildSchemaErrorMessage(error: ZodError): string {
  const issues = error.issues.map(formatZodIssue);
  const lines = [
    "Your JSON has structural issues.",
    "",
    ...issues,
    "",
    "Regenerate the complete and valid JSON directly. Do not add explanations.",
  ];

  return lines.join("\n");
}

export function listSchemaIssues(error: ZodError): readonly string[] {
  return error.issues.map(formatZodIssue);
}

export function buildBusinessErrorMessage(issues: readonly string[]): string {
  const lines = [
    "Your JSON has the following issues.",
    "",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Regenerate the complete and valid JSON directly. Do not add explanations.",
  ];

  return lines.join("\n");
}

function formatZodIssue(issue: core.$ZodIssue): string {
  const location = issue.path.length === 0 ? "<root>" : issue.path.join(".");

  return `- **${location}**: ${issue.message}`;
}
