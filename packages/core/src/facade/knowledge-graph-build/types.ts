import type {
  FragmentRecord,
  MentionLinkRecord,
  MentionRecord,
} from "../../document/index.js";
import type { WikipageResolverOptions } from "../../wikipage/index.js";
import type { MatchWikispineSentenceCandidatesOptions } from "../../wikimatch/index.js";
import type { GuaranteedRequestController } from "../../guaranteed/index.js";
import type { BuildJobProgressReporter } from "../build-queue/index.js";
import type { ChapterDetails } from "../chapter.js";

export interface ChapterKnowledgeGraphBuildArtifact {
  readonly chapterId: number;
  readonly mentionLinksPath: string;
  readonly mentionsPath: string;
  readonly parameter: GraphBuildParameterInput;
  readonly workspacePath: string;
}

export interface ChapterKnowledgeGraphInputSnapshot {
  readonly details: ChapterDetails;
  readonly fragments: readonly FragmentRecord[];
}

export interface GraphBuildParameterInput {
  readonly language?: string;
  readonly prompt: string;
}

export interface BuildChapterKnowledgeGraphArtifactOptions {
  readonly mentionLinks:
    | AsyncIterable<MentionLinkRecord>
    | Iterable<MentionLinkRecord>;
  readonly mentions: AsyncIterable<MentionRecord> | Iterable<MentionRecord>;
  readonly parameter?: GraphBuildParameterInput;
  readonly workspacePath: string;
}

export interface GenerateChapterKnowledgeGraphArtifactOptions {
  readonly policyPrompt?: string;
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
  readonly resolverOptions?: Omit<WikipageResolverOptions, "progress">;
  readonly wikispine?: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "command" | "dataDir" | "endpoint" | "provider"
  >;
  readonly workspacePath: string;
}

export type KnowledgeGraphProgressTracker =
  GenerateChapterKnowledgeGraphArtifactOptions["progressTracker"];
