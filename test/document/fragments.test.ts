import { describe, expect, it } from "vitest";

import { Fragments } from "../../src/document/index.js";
import { withTempDir } from "../helpers/temp.js";

describe("document/fragments", () => {
  it("creates, stores, and reads committed fragments", async () => {
    await withTempDir("spinedigest-fragments-", async (path) => {
      const fragments = new Fragments(path);
      await fragments.ensureCreated();

      const draft = await fragments.getSerial(3).createDraft();

      expect(draft.fragmentId).toBe(0);
      expect(draft.addSentence("Alpha", 2)).toStrictEqual([3, 0]);
      expect(draft.addSentence("Beta", 5)).toStrictEqual([3, 1]);
      draft.setSummary("Fragment summary");

      const fragment = await draft.commit();

      expect(fragment).toMatchObject({
        serialId: 3,
        summary: "Fragment summary",
      });
      expect(await fragments.getSerial(3).listFragmentIds()).toStrictEqual([0]);
      expect(await fragments.getSentence([3, 1])).toBe("Beta");
      expect(await fragments.getSummary(3, 0)).toBe("Fragment summary");
      expect(await fragments.getWordsCount(3, 0)).toBe(7);
    });
  });

  it("does not persist empty drafts", async () => {
    await withTempDir("spinedigest-fragments-", async (path) => {
      const fragments = new Fragments(path);
      const draft = await fragments.getSerial(1).createDraft();

      await expect(draft.commit()).resolves.toBeUndefined();
      await expect(
        fragments.getSerial(1).listFragmentIds(),
      ).resolves.toStrictEqual([]);
    });
  });

  it("enforces draft lifecycle rules", async () => {
    await withTempDir("spinedigest-fragments-", async (path) => {
      const serial = new Fragments(path).getSerial(5);
      const draft = await serial.createDraft();

      await expect(serial.createDraft()).rejects.toThrow(
        "Only one fragment draft can be open at a time",
      );

      draft.discard();

      const nextDraft = await serial.createDraft();
      nextDraft.addSentence("Gamma", 1);
      await nextDraft.commit();

      expect(() => nextDraft.addSentence("Delta", 1)).toThrow(
        "Fragment draft is already finalized",
      );
      await expect(new Fragments(path).getSentence([5, 4])).rejects.toThrow(
        "Sentence 4 does not exist",
      );
    });
  });

  it("returns serial-wide sentence ids across multiple fragments", async () => {
    await withTempDir("spinedigest-fragments-", async (path) => {
      const serial = new Fragments(path).getSerial(7);
      const first = await serial.createDraft();

      expect(first.addSentence("Alpha", 1)).toStrictEqual([7, 0]);
      expect(first.addSentence("Beta", 1)).toStrictEqual([7, 1]);
      await first.commit();

      const second = await serial.createDraft();

      expect(second.addSentence("Gamma", 1)).toStrictEqual([7, 2]);
      await second.commit();

      const fragments = new Fragments(path);

      await expect(fragments.getSentence([7, 2])).resolves.toBe("Gamma");
    });
  });
});
