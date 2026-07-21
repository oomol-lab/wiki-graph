import { access, mkdir, writeFile } from "fs/promises";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { withTempDir } from "../helpers/temp.js";

import {
  createTemporaryOutputPath,
  readTextStreamFromStdin,
  removeTemporaryDirectory,
  writeBinaryToStdout,
  writeTextFileToStdout,
  writeTextToStdout,
} from "../../packages/cli/src/cli/support/index.js";

describe("cli/io", () => {
  let stdoutChunks: unknown[];
  let stdoutWrite: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    stdoutChunks = [];
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk, callbackOrEncoding, callback) => {
        stdoutChunks.push(chunk);
        const writeCallback =
          typeof callbackOrEncoding === "function"
            ? callbackOrEncoding
            : callback;

        writeCallback?.();
        return true;
      });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it("configures stdin for utf8 text and returns the stdin stream", () => {
    const setEncoding = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);

    expect(readTextStreamFromStdin()).toBe(process.stdin);
    expect(setEncoding).toHaveBeenCalledWith("utf8");
  });

  it("pipes a utf8 file into stdout", async () => {
    await withTempDir("wikigraph-io-", async (path) => {
      const filePath = `${path}/result.txt`;

      await writeFile(filePath, "hello stdout", "utf8");
      await writeTextFileToStdout(filePath);

      expect(stdoutChunks.join("")).toBe("hello stdout");
    });
  });

  it("writes multiple stdout chunks without ending stdout", async () => {
    await writeTextToStdout("first\n");
    await writeTextToStdout("second\n");

    expect(stdoutChunks).toStrictEqual(["first\n", "second\n"]);
  });

  it("writes binary data to stdout", async () => {
    const data = new Uint8Array([1, 2, 3]);

    await writeBinaryToStdout(data);

    expect(stdoutChunks).toStrictEqual([data]);
  });

  it("creates temporary output paths inside a new directory", async () => {
    const output = await createTemporaryOutputPath(
      "wikigraph-io-output-",
      ".md",
    );

    try {
      await expect(access(output.directoryPath)).resolves.toBeUndefined();
      expect(output.filePath).toBe(`${output.directoryPath}/output.md`);
    } finally {
      await removeTemporaryDirectory(output.directoryPath);
    }
  });

  it("removes temporary directories recursively", async () => {
    await withTempDir("wikigraph-io-", async (path) => {
      const directoryPath = `${path}/to-remove`;

      await mkdir(`${directoryPath}/nested`, { recursive: true });
      await writeFile(`${directoryPath}/nested/file.txt`, "temp", "utf8");

      await removeTemporaryDirectory(directoryPath);

      await expect(access(directoryPath)).rejects.toThrow();
    });
  });
});
