export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export function formatError(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && !visited.has(current)) {
    visited.add(current);

    if (current instanceof Error) {
      pushErrorMessage(messages, describeError(current));
      current = current.cause;
      continue;
    }

    pushErrorMessage(messages, String(current as unknown));
    break;
  }

  return messages.join(": ");
}

function describeError(error: Error): string {
  const errnoError = error as NodeJS.ErrnoException;
  const message = error.message.trim();
  const code =
    typeof errnoError.code === "string" && errnoError.code !== ""
      ? errnoError.code
      : undefined;
  const path =
    typeof errnoError.path === "string" && errnoError.path !== ""
      ? errnoError.path
      : undefined;

  if (code === "ENOENT") {
    return path === undefined
      ? "File not found (ENOENT)"
      : `File not found: ${path} (ENOENT)`;
  }

  if (code === "EACCES" || code === "EPERM") {
    return path === undefined
      ? `Permission denied (${code})`
      : `Permission denied: ${path} (${code})`;
  }

  if (message === "") {
    return code === undefined ? error.name : `${error.name} (${code})`;
  }

  return code === undefined ? message : `${message} (${code})`;
}

function pushErrorMessage(messages: string[], message: string): void {
  const normalizedMessage = message.trim();

  if (normalizedMessage === "") {
    return;
  }

  const lastMessage = messages.at(-1);

  if (lastMessage === undefined) {
    messages.push(normalizedMessage);
    return;
  }

  if (
    lastMessage === normalizedMessage ||
    lastMessage.includes(normalizedMessage)
  ) {
    return;
  }

  if (normalizedMessage.includes(lastMessage)) {
    messages[messages.length - 1] = normalizedMessage;
    return;
  }

  messages.push(normalizedMessage);
}
