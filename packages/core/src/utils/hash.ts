import { createPortableHash, type PortableHash } from "./crypto.js";
import { bytesToBase32, bytesToHex } from "./bytes.js";

const UNSERIALIZABLE = Symbol("UNSERIALIZABLE");

type ResolvedHashValue = boolean | number | object | string | null;

export function createHash(value: unknown): string {
  return new HashComputation("sha512").run(value, "hex");
}

export function createBase32Hash(value: unknown): string {
  return new HashComputation("sha256").run(value, "base32");
}

class HashComputation {
  readonly #activeObjects = new Set<object>();
  readonly #hash: PortableHash;
  readonly #resolvingObjects = new Set<object>();

  public constructor(algorithm: "sha256" | "sha512") {
    this.#hash = createPortableHash(algorithm);
  }

  public run(value: unknown, encoding: "hex" | "base32"): string {
    const hasSerializedValue = this.#writeValue(value, "");

    if (!hasSerializedValue) {
      throw new TypeError("Hash input must be JSON-serializable");
    }

    const digest = this.#hash.digest();
    return encoding === "hex" ? bytesToHex(digest) : bytesToBase32(digest);
  }

  #writeValue(value: unknown, key: string): boolean {
    const resolvedValue = this.#resolveValue(value, key);

    if (resolvedValue === UNSERIALIZABLE) {
      return false;
    }

    this.#writeResolvedValue(resolvedValue);
    return true;
  }

  #writeResolvedValue(value: ResolvedHashValue): void {
    if (value === null) {
      this.#hash.update("null", "utf8");
      return;
    }

    if (typeof value === "string") {
      this.#hash.update(JSON.stringify(value), "utf8");
      return;
    }

    if (typeof value === "number") {
      this.#hash.update(
        Number.isFinite(value) ? String(value) : "null",
        "utf8",
      );
      return;
    }

    if (typeof value === "boolean") {
      this.#hash.update(value ? "true" : "false", "utf8");
      return;
    }

    if (this.#activeObjects.has(value)) {
      throw new TypeError("Hash input must be JSON-serializable");
    }

    this.#activeObjects.add(value);

    try {
      if (Array.isArray(value)) {
        this.#writeArray(value);
        return;
      }

      this.#writeObject(value);
    } finally {
      this.#activeObjects.delete(value);
    }
  }

  #writeArray(values: readonly unknown[]): void {
    this.#hash.update("[", "utf8");

    for (const [index, value] of values.entries()) {
      if (index > 0) {
        this.#hash.update(",", "utf8");
      }

      const resolvedValue = this.#resolveValue(value, String(index));

      if (resolvedValue === UNSERIALIZABLE) {
        this.#hash.update("null", "utf8");
        continue;
      }

      this.#writeResolvedValue(resolvedValue);
    }

    this.#hash.update("]", "utf8");
  }

  #writeObject(value: object): void {
    this.#hash.update("{", "utf8");

    let hasWrittenProperty = false;

    for (const key of Object.keys(value)) {
      const propertyValue = (value as Record<string, unknown>)[key];
      const resolvedValue = this.#resolveValue(propertyValue, key);

      if (resolvedValue === UNSERIALIZABLE) {
        continue;
      }

      if (hasWrittenProperty) {
        this.#hash.update(",", "utf8");
      }

      this.#hash.update(JSON.stringify(key), "utf8");
      this.#hash.update(":", "utf8");
      this.#writeResolvedValue(resolvedValue);
      hasWrittenProperty = true;
    }

    this.#hash.update("}", "utf8");
  }

  #resolveValue(
    value: unknown,
    key: string,
  ): ResolvedHashValue | typeof UNSERIALIZABLE {
    if (value === null) {
      return null;
    }

    if (typeof value === "string" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol"
    ) {
      return UNSERIALIZABLE;
    }

    if (typeof value === "bigint") {
      throw new TypeError("Hash input must be JSON-serializable");
    }

    if (
      value instanceof String ||
      value instanceof Number ||
      value instanceof Boolean
    ) {
      return this.#resolveValue(value.valueOf(), key);
    }

    if (!hasToJson(value)) {
      return value;
    }

    if (this.#resolvingObjects.has(value)) {
      throw new TypeError("Hash input must be JSON-serializable");
    }

    this.#resolvingObjects.add(value);

    try {
      return this.#resolveValue(value.toJSON(key), key);
    } finally {
      this.#resolvingObjects.delete(value);
    }
  }
}

function hasToJson(
  value: object,
): value is object & { toJSON(key: string): unknown } {
  return "toJSON" in value && typeof value.toJSON === "function";
}
