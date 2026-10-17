import { describe, expect, it } from "vitest";
import type {
  BookMeta,
  ChapterStage,
  HostDatabaseConnection,
  HostDatabaseOpenOptions,
  HostDatabaseProvider,
  HostDatabaseRow,
  HostDatabaseValue,
  WikiGraphPlatform,
  WikiGraphSerialEntry,
} from "wiki-graph-sdk";
import { createWikiGraphSDK } from "wiki-graph-sdk";

type ConsumerSurface = {
  readonly bookMeta?: BookMeta;
  readonly stage: ChapterStage;
  readonly serial: WikiGraphSerialEntry;
  readonly database: HostDatabaseProvider;
  readonly connection: HostDatabaseConnection;
  readonly options: HostDatabaseOpenOptions;
  readonly row: HostDatabaseRow;
  readonly value: HostDatabaseValue;
  readonly platform: WikiGraphPlatform;
};

describe("SDK consumer public boundary", () => {
  it("exposes the documented type surface without importing Core", () => {
    const surface = undefined as unknown as ConsumerSurface;
    expect(surface).toBeUndefined();
  });

  it("exposes SDK archive and schema operations at runtime", () => {
    const sdk = createWikiGraphSDK({
      stateDir: "/tmp/wiki-graph-sdk-consumer",
    });
    expect(typeof sdk.archives.inspectSchema).toBe("function");
    expect(typeof sdk.maintenance.upgrade).toBe("function");
    sdk.close();
  });
});
