import { randomBytes } from "crypto";
import { copyFile, mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWikiGraphSDK,
  type WikiGraphLibraryArchiveContent,
  type WikiGraphSDK,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        async (directory) =>
          await rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("WikiGraphLibraryManager.readArchive", () => {
  it("streams the complete managed archive without exposing its path", async () => {
    const setup = await createManagedArchive({ large: true });
    const expected = await readFile(setup.managedPath);
    let escaped!: AsyncIterable<Uint8Array>;
    let chunkCount = 0;

    const returnedSize = await setup.sdk.libraries.readArchive(
      setup.memberUri,
      async (content) => {
        expect(Object.keys(content).sort()).toEqual([
          "mediaType",
          "size",
          "stream",
          "uri",
        ]);
        expect(content).toMatchObject({
          mediaType: "application/vnd.wiki-graph.archive",
          size: expected.byteLength,
          uri: setup.memberUri,
        });
        expect(JSON.stringify(content)).not.toContain(setup.managedPath);
        escaped = content.stream;
        const chunks: Uint8Array[] = [];
        for await (const chunk of content.stream) {
          chunkCount += 1;
          chunks.push(chunk);
        }
        expect(
          Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
        ).toEqual(expected);
        return content.size;
      },
    );

    expect(returnedSize).toBe(expected.byteLength);
    expect(chunkCount).toBeGreaterThan(1);
    expect(() => escaped[Symbol.asyncIterator]()).toThrow(
      "cannot be read after its callback has finished",
    );
    setup.sdk.close();
  });

  it("closes the session after an early stream exit or callback failure", async () => {
    const setup = await createManagedArchive();

    await setup.sdk.libraries.readArchive(
      setup.memberUri,
      async ({ stream }) => {
        for await (const _chunk of stream) break;
      },
    );
    await expect(
      setup.sdk.libraries.moveArchive({
        target: setup.memberUri,
        to: "moved.wikg",
      }),
    ).resolves.toMatchObject({ relativePath: "moved.wikg" });

    const moved = (await setup.library.archives()).find(
      (archive) => archive.relativePath === "moved.wikg",
    );
    expect(moved).toBeDefined();
    await expect(
      setup.sdk.libraries.readArchive(moved!.uri, () => {
        throw new Error("consumer failed");
      }),
    ).rejects.toThrow("consumer failed");
    await expect(
      setup.sdk.libraries.removeArchive(moved!.uri),
    ).resolves.toMatchObject({ exists: false });
    setup.sdk.close();
  });

  it("aborts the callback session and invalidates an escaped stream", async () => {
    const setup = await createManagedArchive();
    const controller = new AbortController();
    const entered = deferred<void>();
    let escaped!: AsyncIterable<Uint8Array>;
    const reading = setup.sdk.libraries.readArchive(
      setup.memberUri,
      async ({ stream }) => {
        escaped = stream;
        entered.resolve();
        await new Promise<void>(() => undefined);
      },
      { signal: controller.signal },
    );

    await entered.promise;
    controller.abort(new Error("stop reading"));
    await expect(reading).rejects.toThrow("stop reading");
    expect(() => escaped[Symbol.asyncIterator]()).toThrow(
      "cannot be read after its callback has finished",
    );
    await expect(
      setup.sdk.libraries.moveArchive({
        target: setup.memberUri,
        to: "after-abort.wikg",
      }),
    ).resolves.toMatchObject({ relativePath: "after-abort.wikg" });
    setup.sdk.close();
  });

  it("allows concurrent readers", async () => {
    const setup = await createManagedArchive();
    const release = deferred<void>();
    const firstEntered = deferred<void>();
    const secondEntered = deferred<void>();
    const read = async (entered: Deferred<void>): Promise<void> =>
      await setup.sdk.libraries.readArchive(
        setup.memberUri,
        async ({ stream }) => {
          const iterator = stream[Symbol.asyncIterator]();
          await iterator.next();
          entered.resolve();
          await release.promise;
        },
      );

    const first = read(firstEntered);
    await firstEntered.promise;
    const second = read(secondEntered);
    await secondEntered.promise;
    release.resolve();
    await Promise.all([first, second]);
    setup.sdk.close();
  });

  for (const operation of ["move", "remove", "replace"] as const) {
    it(`holds the read lock while ${operation} waits`, async () => {
      const setup = await createManagedArchive();
      const entered = deferred<void>();
      const release = deferred<void>();
      const reading = setup.sdk.libraries.readArchive(
        setup.memberUri,
        async ({ stream }) => {
          await stream[Symbol.asyncIterator]().next();
          entered.resolve();
          await release.promise;
        },
      );
      await entered.promise;

      let writeFinished = false;
      const writing = runLibraryWrite(setup, operation).finally(() => {
        writeFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(writeFinished).toBe(false);

      release.resolve();
      await reading;
      await writing;
      expect(writeFinished).toBe(true);
      setup.sdk.close();
    });
  }

  it("rejects non-archive, missing, and conflicting library targets", async () => {
    const setup = await createManagedArchive();
    const consume = (_content: WikiGraphLibraryArchiveContent) => undefined;

    await expect(
      setup.sdk.libraries.readArchive(setup.library.uri, consume),
    ).rejects.toThrow("Expected a Wiki Graph library archive URI");
    await expect(
      setup.sdk.libraries.readArchive(`${setup.memberUri}/entity`, consume),
    ).rejects.toThrow("Expected a Wiki Graph library archive URI");

    await rm(setup.managedPath);
    await expect(
      setup.sdk.libraries.readArchive(setup.memberUri, consume),
    ).rejects.toThrow(`archive is missing: ${setup.memberUri}`);

    const conflictSetup = await createManagedArchive();
    await copyFile(
      conflictSetup.managedPath,
      join(conflictSetup.libraryPath, "a-copy.wikg"),
    );
    const scan = await conflictSetup.library.scan();
    const conflict = scan.archives.find(
      (archive) => archive.status === "conflict",
    );
    expect(conflict).toBeDefined();
    await expect(
      conflictSetup.sdk.libraries.readArchive(conflict!.uri, consume),
    ).rejects.toThrow("has a conflict and cannot be read");
    setup.sdk.close();
    conflictSetup.sdk.close();
  });
});

interface ManagedArchiveSetup {
  readonly library: Awaited<ReturnType<WikiGraphSDK["libraries"]["create"]>>;
  readonly libraryPath: string;
  readonly managedPath: string;
  readonly memberUri: string;
  readonly replacementPath: string;
  readonly sdk: WikiGraphSDK;
}

async function createManagedArchive(
  options: { readonly large?: boolean } = {},
): Promise<ManagedArchiveSetup> {
  const root = await mkdtemp(join(tmpdir(), "wiki-graph-sdk-library-stream-"));
  temporaryDirectories.push(root);
  const sdk = createWikiGraphSDK({ cwd: root, stateDir: join(root, "state") });
  const sourcePath = join(root, "source.wikg");
  const replacementPath = join(root, "replacement.wikg");
  await sdk.archives.create({ path: sourcePath });
  const source = await sdk.archives.open({
    kind: "standalone",
    path: sourcePath,
  });
  await source.addChapter({
    source:
      options.large === true
        ? randomBytes(256 * 1024).toString("base64")
        : "A stable archive source.",
    title: "Source",
  });
  await sdk.archives.create({ path: replacementPath });
  const replacement = await sdk.archives.open({
    kind: "standalone",
    path: replacementPath,
  });
  await replacement.addChapter({
    source: "Replacement.",
    title: "Replacement",
  });
  const libraryPath = join(root, "library");
  const library = await sdk.libraries.create(libraryPath);
  const member = await sdk.libraries.addArchive({
    inputPath: sourcePath,
    target: library.uri,
    to: "book.wikg",
  });

  return {
    library,
    libraryPath,
    managedPath: join(libraryPath, "book.wikg"),
    memberUri: member.uri,
    replacementPath,
    sdk,
  };
}

async function runLibraryWrite(
  setup: ManagedArchiveSetup,
  operation: "move" | "remove" | "replace",
): Promise<void> {
  switch (operation) {
    case "move":
      await setup.sdk.libraries.moveArchive({
        target: setup.memberUri,
        to: "moved.wikg",
      });
      return;
    case "remove":
      await setup.sdk.libraries.removeArchive(setup.memberUri);
      return;
    case "replace":
      await setup.sdk.libraries.replaceArchive({
        inputPath: setup.replacementPath,
        target: setup.memberUri,
      });
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
