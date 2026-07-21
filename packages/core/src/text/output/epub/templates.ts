import { resolveDataDirPath } from "../../../runtime/common/data-dir.js";
import { createEnv } from "../../../runtime/common/template.js";

let templateEnvironment: ReturnType<typeof createEnv> | undefined;

function getTemplateEnvironment(): ReturnType<typeof createEnv> {
  templateEnvironment ??= createEnv(resolveDataDirPath());

  return templateEnvironment;
}

export function renderCoverPage(input: {
  readonly coverImageHref: string;
  readonly language: string;
  readonly title: string;
}): string {
  return getTemplateEnvironment().render("output/epub/cover.xhtml", input);
}

export function renderNavDocument(input: {
  readonly itemsMarkup: string;
  readonly language: string;
  readonly title: string;
}): string {
  return getTemplateEnvironment().render("output/epub/nav.xhtml", input);
}

export function renderPackageOpf(input: {
  readonly authors: readonly string[];
  readonly coverImageHref: string | undefined;
  readonly coverMediaType: string | undefined;
  readonly coverPageHref: string | undefined;
  readonly description: string | null;
  readonly identifier: string;
  readonly language: string;
  readonly modifiedAt: string;
  readonly publishedAt: string | null;
  readonly publisher: string | null;
  readonly sections: readonly {
    readonly href: string;
    readonly id: string;
  }[];
  readonly title: string;
  readonly version: string;
}): string {
  return getTemplateEnvironment().render("output/epub/package.opf.xml", input);
}

export function renderSectionDocument(input: {
  readonly language: string;
  readonly paragraphs: readonly string[];
  readonly title: string;
}): string {
  return getTemplateEnvironment().render("output/epub/section.xhtml", input);
}
