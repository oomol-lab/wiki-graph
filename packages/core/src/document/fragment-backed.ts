import type { ReadonlyDocument } from "./directory/index.js";
import { Fragments } from "./fragments/index.js";
import type { SentenceId } from "./types.js";

export function createFragmentBackedDocument<
  TDocument extends ReadonlyDocument,
>(document: TDocument, documentPath: string): TDocument {
  const fragments = new Fragments(documentPath);

  return new Proxy(document, {
    get(target, property, receiver): unknown {
      if (property === "getSerialFragments") {
        return (serialId: number) => fragments.getSerial(serialId);
      }
      if (property === "getSummaryFragments") {
        return (serialId: number) => fragments.getSummarySerial(serialId);
      }
      if (property === "getSentence") {
        return async (sentenceId: SentenceId) =>
          await fragments.getSentence(sentenceId);
      }

      const value = Reflect.get(target, property, receiver) as unknown;

      if (typeof value !== "function") {
        return value;
      }

      return value.bind(target) as unknown;
    },
  });
}
