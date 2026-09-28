export interface WikimediaResolveInput {
  readonly disambiguation: boolean;
  readonly qid: string;
}

export interface WikimediaLanguageProfile {
  readonly description: string | null;
  readonly label: string | null;
  readonly url: string | null;
}

export interface WikimediaDisambiguationItem {
  readonly information: string;
  readonly qid: string;
}

export interface WikimediaResolution {
  readonly disambiguation?: readonly WikimediaDisambiguationItem[];
  readonly en: WikimediaLanguageProfile;
  readonly qid: string;
  readonly zh: WikimediaLanguageProfile;
}

export interface WikimediaResolver {
  readonly resolve: (
    input: readonly WikimediaResolveInput[],
  ) => Promise<readonly WikimediaResolution[]>;
}
