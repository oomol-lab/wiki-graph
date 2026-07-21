export function cleanChunkTags(text: string): string {
  return text.replace(/<chunk(?:\s+[^>]*)?>/g, "").replace(/<\/chunk>/g, "");
}

export function extractCompressedText(fullResponse: string): string {
  const matchedCompressedSection = fullResponse.match(
    /##\s*(?:Compressed\s+Text|压缩文本)\s*\n+(.*?)(?:\n+---|\*\*CRITICAL\*\*|$)/is,
  );

  if (matchedCompressedSection?.[1] !== undefined) {
    return unwrapMarkdownCodeFence(matchedCompressedSection[1].trim());
  }

  return unwrapMarkdownCodeFence(fullResponse.trim());
}

export function extractThinkingText(fullResponse: string): string {
  const matchedCompressedSection = fullResponse.match(
    /##\s*(?:Compressed\s+Text|压缩文本)\s*/i,
  );

  if (matchedCompressedSection?.index === undefined) {
    return "";
  }

  return fullResponse.slice(0, matchedCompressedSection.index).trim();
}

function unwrapMarkdownCodeFence(text: string): string {
  const matchedFence = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);

  return matchedFence?.[1]?.trim() ?? text;
}
