export const DEFAULT_EXTRACTION_PROMPT =
  "Focus on the main storyline and key character developments. Preserve important dialogues and critical plot points. Background descriptions and minor details can be compressed significantly.";

export const DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT = [
  "Recall only source mentions that should become stable searchable knowledge graph objects.",
  "Prefer named entities: historical persons, places, organizations, dynasties, political entities, named works, named events, battles, titles, and explicitly named domain concepts.",
  "Recall a non-named common concept only when it is a central recurring topic of the chapter and would be useful as an entity search result across multiple evidence passages.",
  "Do not recall a surface merely because it is useful for summarizing the story or explaining a detail.",
  "Do not recall pure numbers, standalone dates without a named event role, units of measurement, dimensions, ordinal labels, chapter numbers, punctuation fragments, common function words, generic verbs, generic adjectives, generic roles, generic objects, or incidental attributes.",
  "Measurements, quantities, dimensions, tactical details, and descriptive attributes should remain evidence text, not entity mentions.",
  "When uncertain, skip the mention rather than creating a noisy knowledge graph object.",
].join(" ");

export function resolveExtractionPrompt(prompt: string | undefined): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_EXTRACTION_PROMPT
    : normalizedPrompt;
}

export function resolveKnowledgeGraphRecallPrompt(
  prompt: string | undefined,
): string {
  const normalizedPrompt = prompt?.trim();

  return normalizedPrompt === undefined || normalizedPrompt === ""
    ? DEFAULT_KNOWLEDGE_GRAPH_RECALL_PROMPT
    : normalizedPrompt;
}
