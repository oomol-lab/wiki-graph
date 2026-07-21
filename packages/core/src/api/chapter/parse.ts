import { z } from "zod";

import type { ChapterTreeInput, ChapterTreeInputNode } from "./types.js";

const chapterTreeInputNodeSchema: z.ZodType<ChapterTreeInputNode> = z
  .object({
    children: z.lazy(() => z.array(chapterTreeInputNodeSchema)),
    id: z.number().int().nonnegative(),
    title: z.string().nullable().optional(),
  })
  .strict();

const chapterTreeInputSchema: z.ZodType<ChapterTreeInput> = z
  .object({
    chapters: z.array(chapterTreeInputNodeSchema),
  })
  .strict();

export function parseChapterTreeInput(input: unknown): ChapterTreeInput {
  return chapterTreeInputSchema.parse(input);
}
