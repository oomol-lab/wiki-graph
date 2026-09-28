import type {
  FragmentRecord,
  MentionLinkRecord,
  MentionRecord,
} from "../../document/index.js";
import type { GuaranteedRequestController } from "../../external/guaranteed/index.js";
import type { WikimediaResolver } from "../../external/wikipage/index.js";
import type { MatchWikispineSentenceCandidatesOptions } from "../../external/wikimatch/index.js";
import type { BuildJobProgressReporter } from "../../runtime/jobs/index.js";
import type { ChapterDetails } from "../../document/chapter/index.js";
import type { Directory, File } from "../../runtime/platform/index.js";

export interface ChapterKnowledgeGraphBuildArtifact {
  readonly chapterId: number;
  readonly mentionLinksFile: File;
  readonly mentionsFile: File;
  readonly objectsFile: File;
  readonly parameter: GraphBuildParameterInput;
  readonly workspace: Directory;
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
  readonly workspace: Directory;
}

export interface GenerateChapterKnowledgeGraphArtifactOptions {
  readonly language?: string;
  readonly policyPrompt?: string;
  readonly progressTracker?: Pick<
    BuildJobProgressReporter,
    "throwIfStopped" | "updatePhase"
  >;
  readonly request: GuaranteedRequestController;
  readonly wikimediaResolver: WikimediaResolver;
  readonly wikispine?: Pick<
    MatchWikispineSentenceCandidatesOptions,
    "command" | "commandRunner" | "dataDir" | "endpoint" | "provider"
  >;
  readonly workspace: Directory;
}

export type KnowledgeGraphProgressTracker =
  GenerateChapterKnowledgeGraphArtifactOptions["progressTracker"];
