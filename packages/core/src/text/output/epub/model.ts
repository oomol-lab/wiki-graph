import type { BookMeta, SourceAsset } from "../../source/index.js";

export interface EpubBook {
  readonly cover: SourceAsset | undefined;
  readonly meta: BookMeta;
  readonly navXhtml: string;
  readonly packageOpf: string;
  readonly sections: readonly EpubSection[];
}

export interface EpubNavItem {
  readonly children: readonly EpubNavItem[];
  readonly href: string | undefined;
  readonly title: string;
}

export interface EpubSection {
  readonly href: string;
  readonly id: string;
  readonly title: string;
  readonly xhtml: string;
}
