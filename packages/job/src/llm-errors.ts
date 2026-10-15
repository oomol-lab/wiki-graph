export function isPaymentRequiredError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    if ((current as { readonly statusCode?: unknown }).statusCode === 402)
      return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}
