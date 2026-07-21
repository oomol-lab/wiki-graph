import type {
  LLMessage,
  LLMLazyRequestOperation,
  LLMRequestFunction,
  LLMRequestOptions,
} from "../../packages/core/src/external/llm/index.js";

export interface ScriptedLLMCall<S extends string> {
  readonly messages: readonly LLMessage[];
  readonly options: LLMRequestOptions<S>;
  readonly viaContext: boolean;
}

export interface ScriptedPromptCall {
  readonly templateContext: Record<string, unknown>;
  readonly templateName: string;
}

export type ScriptedLLMStep<S extends string> =
  | string
  | Error
  | ((call: ScriptedLLMCall<S>) => string | Promise<string>);

export class ScriptedLLM<S extends string> {
  public readonly calls: ScriptedLLMCall<S>[] = [];
  public readonly prompts: ScriptedPromptCall[] = [];
  readonly #steps: ScriptedLLMStep<S>[];

  public constructor(steps: readonly ScriptedLLMStep<S>[] = []) {
    this.#steps = [...steps];
  }

  public enqueue(...steps: readonly ScriptedLLMStep<S>[]): void {
    this.#steps.push(...steps);
  }

  public loadSystemPrompt(
    templateName: string,
    templateContext: Record<string, unknown> = {},
  ): string {
    this.prompts.push({
      templateContext,
      templateName,
    });

    return `[${templateName}] ${JSON.stringify(templateContext)}`;
  }

  public async request(
    messages: readonly LLMessage[],
    options?: LLMRequestOptions<S>,
  ): Promise<string>;
  public async request<T>(operation: LLMLazyRequestOperation<S, T>): Promise<T>;
  public async request<T>(
    input: readonly LLMessage[] | LLMLazyRequestOperation<S, T>,
    options: LLMRequestOptions<S> = {},
  ): Promise<string | T> {
    if (typeof input === "function") {
      return await input(this.#requestOnce);
    }

    return await this.#requestOnce(input, options);
  }

  readonly #requestOnce: LLMRequestFunction<S> = async (
    messages,
    options = {},
  ) => await this.#consume(messages, options, false);

  public async withContext<T>(
    operation: (context: {
      request(
        messages: readonly LLMessage[],
        options?: LLMRequestOptions<S>,
      ): Promise<string>;
    }) => Promise<T>,
  ): Promise<T> {
    return await operation({
      request: async (
        messages: readonly LLMessage[],
        options: LLMRequestOptions<S> = {},
      ): Promise<string> => await this.#consume(messages, options, true),
    });
  }

  async #consume(
    messages: readonly LLMessage[],
    options: LLMRequestOptions<S>,
    viaContext: boolean,
  ): Promise<string> {
    const call = {
      messages,
      options,
      viaContext,
    } satisfies ScriptedLLMCall<S>;

    this.calls.push(call);

    const step = this.#steps.shift();

    if (step === undefined) {
      throw new Error("ScriptedLLM ran out of scripted responses");
    }

    if (typeof step === "function") {
      return await step(call);
    }

    if (step instanceof Error) {
      throw step;
    }

    return step;
  }
}
