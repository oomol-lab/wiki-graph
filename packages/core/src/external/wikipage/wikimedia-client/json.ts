export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function getString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function getNestedString(
  value: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let current: unknown = value;

  for (const part of path) {
    current = asRecord(current)[part];
  }

  return getString(current);
}
