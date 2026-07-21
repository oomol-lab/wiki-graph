export class LLMPaymentRequiredError extends Error {
  public readonly isRetryable = false;
  public readonly statusCode = 402;

  public constructor(
    message = "LLM payment required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LLMPaymentRequiredError";
  }
}
