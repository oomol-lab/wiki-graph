export class ParsedJsonError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Parse failed with ${issues.length} issue(s)`);
    this.name = "ParsedJsonError";
    this.issues = [...issues];
  }
}

export abstract class GuaranteedRequestFailureError extends Error {
  public readonly attempts: number;
  public readonly maxRetries: number;

  protected constructor(message: string, attempts: number, maxRetries: number) {
    super(message);
    this.name = "GuaranteedRequestFailureError";
    this.attempts = attempts;
    this.maxRetries = maxRetries;
  }
}

export class GuaranteedEmptyResponseError extends GuaranteedRequestFailureError {
  public constructor(attempts: number, maxRetries: number) {
    super(
      "LLM returned empty response after all retries",
      attempts,
      maxRetries,
    );
    this.name = "GuaranteedEmptyResponseError";
  }
}

export class SuspectedModelRefusalError extends GuaranteedRequestFailureError {
  public readonly response: string;
  public readonly reason: string;

  public constructor(
    attempts: number,
    maxRetries: number,
    input: {
      response: string;
      reason: string;
    },
  ) {
    super(
      `Suspected model refusal after ${attempts} JSON syntax error attempt(s): ${input.reason}. Last response: ${JSON.stringify(input.response)}`,
      attempts,
      maxRetries,
    );
    this.name = "SuspectedModelRefusalError";
    this.response = input.response;
    this.reason = input.reason;
  }
}

export class GuaranteedSchemaValidationError extends GuaranteedRequestFailureError {
  public readonly issues: readonly string[];
  public readonly response: string;

  public constructor(
    attempts: number,
    maxRetries: number,
    input: {
      issues: readonly string[];
      response: string;
    },
    cause: unknown,
  ) {
    super("Schema validation failed after all retries", attempts, maxRetries);
    this.name = "GuaranteedSchemaValidationError";
    this.issues = [...input.issues];
    this.response = input.response;
    this.cause = cause;
  }
}

export class GuaranteedParseValidationError extends GuaranteedRequestFailureError {
  public readonly issues: readonly string[];
  public readonly response: string;

  public constructor(
    attempts: number,
    maxRetries: number,
    input: {
      issues: readonly string[];
      response: string;
    },
    cause: unknown,
  ) {
    super("Parse validation failed after all retries", attempts, maxRetries);
    this.name = "GuaranteedParseValidationError";
    this.issues = [...input.issues];
    this.response = input.response;
    this.cause = cause;
  }
}
