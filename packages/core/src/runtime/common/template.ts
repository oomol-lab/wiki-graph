import { readFileSync, statSync } from "fs";
import { resolve, sep } from "path";

import { Environment, Loader, type LoaderSource } from "nunjucks";

const JINJA_EXTENSION_PATTERN = /\.jinja$/i;
const LEADING_DOT_SEGMENT_PATTERN = /^\.+\//;
const LEADING_SLASH_PATTERN = /^\/+/;

type LoaderSourceWithUpdateCheck = LoaderSource & {
  upToDate: () => boolean;
};

export function createEnv(
  dirPath: string,
  options: {
    readonly autoescape?: boolean;
    readonly trimBlocks?: boolean;
  } = {},
): Environment {
  return new Environment(new DSTemplateLoader(resolve(dirPath)), {
    autoescape: options.autoescape ?? true,
    trimBlocks: options.trimBlocks ?? true,
  });
}

class DSTemplateLoader extends Loader {
  readonly #dirPath: string;

  public constructor(dirPath: string) {
    super();
    this.#dirPath = dirPath;
  }

  public getSource(templateName: string): LoaderSourceWithUpdateCheck {
    const normalizedTemplateName = normalizeTemplateName(templateName);
    const targetPath = resolve(this.#dirPath, normalizedTemplateName);

    assertWithinRoot(this.#dirPath, targetPath, normalizedTemplateName);

    const source = readFileSync(targetPath, "utf8");
    const modifiedTime = statSync(targetPath).mtimeMs;

    return {
      noCache: false,
      path: targetPath,
      src: source,
      upToDate: () => statSync(targetPath).mtimeMs === modifiedTime,
    };
  }
}

function normalizeTemplateName(templateName: string): string {
  if (LEADING_DOT_SEGMENT_PATTERN.test(templateName)) {
    throw new Error(`invalid path ${templateName}`);
  }

  const withoutLeadingSlash = templateName.replace(LEADING_SLASH_PATTERN, "");
  const withoutExtension = withoutLeadingSlash.replace(
    JINJA_EXTENSION_PATTERN,
    "",
  );

  return `${withoutExtension}.jinja`;
}

function assertWithinRoot(
  rootDirPath: string,
  targetPath: string,
  templateName: string,
): void {
  const rootPrefix = rootDirPath.endsWith(sep)
    ? rootDirPath
    : `${rootDirPath}${sep}`;

  if (targetPath === rootDirPath || targetPath.startsWith(rootPrefix)) {
    return;
  }

  throw new Error(`cannot find ${templateName}`);
}
