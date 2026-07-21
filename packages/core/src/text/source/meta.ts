import { z } from "zod";

export const SOURCE_FORMATS = ["epub", "pdf", "txt", "markdown"] as const;
export const BOOK_META_VERSION = 1;

export const sourceFormatSchema = z.enum(SOURCE_FORMATS);

export const bookMetaSchema = z.object({
  version: z.literal(BOOK_META_VERSION),
  sourceFormat: sourceFormatSchema,
  title: z.string().min(1).nullable(),
  authors: z.array(z.string().min(1)),
  language: z.string().min(1).nullable(),
  identifier: z.string().min(1).nullable(),
  publisher: z.string().min(1).nullable(),
  publishedAt: z.string().min(1).nullable(),
  description: z.string().min(1).nullable(),
});

export type SourceFormat = z.infer<typeof sourceFormatSchema>;
export type BookMeta = z.infer<typeof bookMetaSchema>;
