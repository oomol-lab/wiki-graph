import type { Profile, ProfileNormalizer } from "./types.js";
export class DisabledNormalizer implements ProfileNormalizer {
  async normalize(): Promise<Profile> {
    throw new Error("LLM normalizer is required for disambiguation pages");
  }
}
export class HttpProfileNormalizer implements ProfileNormalizer {
  public constructor(private readonly endpoint: string, private readonly token?: string) {}
  async normalize(input: Parameters<ProfileNormalizer["normalize"]>[0]): Promise<Profile> { const response = await fetch(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }, body: JSON.stringify(input) }); if (!response.ok) throw new Error(`LLM normalizer ${response.status}`); const value = await response.json() as Profile; const allowed = new Set(input.page.links.map((x) => x.qid)); return { meanings: (value.meanings ?? []).filter((x) => allowed.has(x.qid) && typeof x.information === "string").map((x) => ({ qid: x.qid, information: x.information })) }; }
}

