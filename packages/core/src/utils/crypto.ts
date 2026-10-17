import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { bytesToHex, encodeUtf8 } from "./bytes.js";

type HashAlgorithm = "sha1" | "sha256" | "sha512";

interface IncrementalHash {
  update(data: Uint8Array): IncrementalHash;
  digest(): Uint8Array;
}

export interface PortableHash {
  update(value: string | Uint8Array, encoding?: "utf8"): PortableHash;
  digest(encoding: "hex"): string;
  digest(): Uint8Array;
}

export function createPortableHash(algorithm: HashAlgorithm): PortableHash {
  const hash = createHasher(algorithm);
  return {
    update(value: string | Uint8Array): PortableHash {
      hash.update(typeof value === "string" ? encodeUtf8(value) : value);
      return this;
    },
    digest(encoding?: "hex"): string | Uint8Array {
      const bytes = hash.digest();
      return encoding === "hex" ? bytesToHex(bytes) : bytes;
    },
  } as PortableHash;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function randomUuid(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A Windows-safe, compact encoding of a full 128-bit random UUID. */
export function randomBase32Uuid(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(16);
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = buffer * 256 + byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[Math.floor(buffer / 2 ** bits) % 32];
    }
    buffer %= 2 ** bits;
  }
  if (bits > 0) output += alphabet[(buffer * 2 ** (5 - bits)) % 32];
  return output;
}

function createHasher(algorithm: HashAlgorithm): IncrementalHash {
  switch (algorithm) {
    case "sha1":
      return sha1.create();
    case "sha256":
      return sha256.create();
    case "sha512":
      return sha512.create();
  }
}
