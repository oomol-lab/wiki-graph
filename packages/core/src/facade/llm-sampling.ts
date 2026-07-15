import { WikiGraphScope } from "../common/llm-scope.js";
import type {
  SamplingProfile,
  SamplingScopeConfig,
  TemperatureSetting,
} from "../llm/index.js";

export type WikiGraphSamplingConfig = SamplingScopeConfig<WikiGraphScope>;

const DEFAULT_WIKI_GRAPH_SAMPLING = Object.freeze({
  [WikiGraphScope.EditorCompress]: Object.freeze({
    temperature: 0.7,
    topP: 0.9,
  }),
  [WikiGraphScope.EditorReview]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  [WikiGraphScope.EditorReviewGuide]: Object.freeze({
    temperature: 0.4,
    topP: 0.6,
  }),
  [WikiGraphScope.ReaderChoice]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
  [WikiGraphScope.ReaderExtraction]: Object.freeze({
    temperature: [0.3, 0.95] as const,
    topP: [0.4, 0.8] as const,
  }),
} satisfies WikiGraphSamplingConfig);

export function createDefaultWikiGraphSampling(
  input: {
    readonly temperature?: TemperatureSetting;
    readonly topP?: TemperatureSetting;
  } = {},
): WikiGraphSamplingConfig {
  return Object.freeze({
    [WikiGraphScope.EditorCompress]: applySamplingOverrides(
      DEFAULT_WIKI_GRAPH_SAMPLING[WikiGraphScope.EditorCompress],
      input,
    ),
    [WikiGraphScope.EditorReview]: applySamplingOverrides(
      DEFAULT_WIKI_GRAPH_SAMPLING[WikiGraphScope.EditorReview],
      input,
    ),
    [WikiGraphScope.EditorReviewGuide]: applySamplingOverrides(
      DEFAULT_WIKI_GRAPH_SAMPLING[WikiGraphScope.EditorReviewGuide],
      input,
    ),
    [WikiGraphScope.ReaderChoice]: applySamplingOverrides(
      DEFAULT_WIKI_GRAPH_SAMPLING[WikiGraphScope.ReaderChoice],
      input,
    ),
    [WikiGraphScope.ReaderExtraction]: applySamplingOverrides(
      DEFAULT_WIKI_GRAPH_SAMPLING[WikiGraphScope.ReaderExtraction],
      input,
    ),
  } satisfies WikiGraphSamplingConfig);
}

function applySamplingOverrides(
  profile: SamplingProfile,
  input: {
    readonly temperature?: TemperatureSetting;
    readonly topP?: TemperatureSetting;
  },
): SamplingProfile {
  return Object.freeze({
    ...profile,
    ...(input.temperature === undefined
      ? {}
      : { temperature: input.temperature }),
    ...(input.topP === undefined ? {} : { topP: input.topP }),
  });
}
