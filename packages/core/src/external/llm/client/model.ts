import type { LLMModel } from "../types.js";

export function resolveModelInfo(model: LLMModel): {
  readonly identity: string;
  readonly modelId: string;
  readonly provider?: string;
} {
  if (typeof model === "string") {
    return {
      identity: model,
      modelId: model,
    };
  }

  if (hasModelMetadata(model)) {
    return {
      identity:
        model.provider === undefined
          ? model.modelId
          : `${model.provider}:${model.modelId}`,
      modelId: model.modelId,
      ...(model.provider === undefined ? {} : { provider: model.provider }),
    };
  }

  return {
    identity: "unknown-model",
    modelId: "unknown-model",
  };
}

function hasModelMetadata(
  model: LLMModel,
): model is LLMModel & { modelId: string; provider?: string } {
  return (
    typeof model === "object" &&
    model !== null &&
    "modelId" in model &&
    typeof model.modelId === "string" &&
    (!("provider" in model) || typeof model.provider === "string")
  );
}
