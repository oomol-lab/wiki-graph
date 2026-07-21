import { z } from "zod";

export const TOC_FILE_VERSION = 1;

export interface TocItem {
  readonly title?: string | null | undefined;
  readonly serialId?: number | undefined;
  readonly children: readonly TocItem[];
}

export const tocItemSchema: z.ZodType<TocItem> = z.object({
  title: z.string().min(1).nullable().optional(),
  serialId: z.number().int().nonnegative().optional(),
  children: z.lazy(() => z.array(tocItemSchema)),
});

export const tocFileSchema = z.object({
  version: z.literal(TOC_FILE_VERSION),
  items: z.array(tocItemSchema),
});

export type TocFile = z.infer<typeof tocFileSchema>;
