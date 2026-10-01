import { execFileSync } from "child_process";
import { createHash } from "crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, isAbsolute, join, relative, resolve } from "path";
import { pathToFileURL } from "url";

interface PackageDescriptor {
  readonly name: string;
  readonly version: string;
}

interface ReleasePackage {
  readonly directory: string;
  readonly expectedName: string;
}

interface RegistryPackage {
  readonly dist?: {
    readonly tarball?: string;
  };
}

type PackageState = "missing" | "matching";

const workspaceRoot = resolve(import.meta.dirname, "..");
const releasePackages: readonly ReleasePackage[] = [
  {
    directory: join(workspaceRoot, "packages", "wikimedia"),
    expectedName: "wiki-graph-wikimedia",
  },
  {
    directory: join(workspaceRoot, "packages", "job"),
    expectedName: "wiki-graph-job",
  },
  {
    directory: join(workspaceRoot, "packages", "core"),
    expectedName: "wiki-graph-core",
  },
  {
    directory: join(workspaceRoot, "packages", "sdk"),
    expectedName: "wiki-graph-sdk",
  },
  {
    directory: join(workspaceRoot, "packages", "cli"),
    expectedName: "wiki-graph",
  },
];

function readPackageDescriptor(directory: string): PackageDescriptor {
  const manifestPath = join(directory, "package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("name" in manifest) ||
    typeof manifest.name !== "string" ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`Invalid package manifest: ${manifestPath}`);
  }
  return { name: manifest.name, version: manifest.version };
}

function readTarballPath(packOutput: string, destination: string): string {
  const result: unknown = JSON.parse(packOutput);
  const firstResult: unknown = Array.isArray(result)
    ? (result as unknown[])[0]
    : result;
  if (
    typeof firstResult !== "object" ||
    firstResult === null ||
    !("filename" in firstResult) ||
    typeof firstResult.filename !== "string"
  ) {
    throw new Error("Unable to read the tarball filename from pnpm pack.");
  }
  return isAbsolute(firstResult.filename)
    ? firstResult.filename
    : join(destination, firstResult.filename);
}

function packPackage(directory: string, destination: string): string {
  const output = execFileSync(
    "pnpm",
    ["pack", "--json", "--pack-destination", destination],
    {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return readTarballPath(output, destination);
}

function extractTarball(tarballPath: string, destination: string): string {
  mkdirSync(destination, { recursive: true });
  execFileSync("tar", ["-xzf", tarballPath, "-C", destination], {
    stdio: "inherit",
  });
  return join(destination, "package");
}

export function packageContentHashes(
  directory: string,
): ReadonlyMap<string, string> {
  const hashes = new Map<string, string>();

  function visit(currentDirectory: string): void {
    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const absolutePath = join(currentDirectory, entry.name);
      const packagePath = relative(directory, absolutePath);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const hash = createHash("sha512");
      if (entry.isSymbolicLink()) {
        hash.update("symlink\0");
        hash.update(readlinkSync(absolutePath));
      } else if (entry.isFile()) {
        hash.update("file\0");
        hash.update(readFileSync(absolutePath));
        hash.update(`\0mode:${statSync(absolutePath).mode & 0o111}`);
      } else {
        throw new Error(`Unsupported package entry: ${absolutePath}`);
      }
      hashes.set(packagePath, hash.digest("hex"));
    }
  }

  visit(directory);
  return hashes;
}

export function packageContentDifference(
  localDirectory: string,
  publishedDirectory: string,
): readonly string[] {
  const localHashes = packageContentHashes(localDirectory);
  const publishedHashes = packageContentHashes(publishedDirectory);
  return [...new Set([...localHashes.keys(), ...publishedHashes.keys()])]
    .filter((path) => localHashes.get(path) !== publishedHashes.get(path))
    .sort();
}

async function downloadPublishedPackage(
  descriptor: PackageDescriptor,
  destination: string,
): Promise<string | undefined> {
  const registryUrl = new URL(
    `${encodeURIComponent(descriptor.name)}/${encodeURIComponent(descriptor.version)}`,
    "https://registry.npmjs.org/",
  );
  const metadataResponse = await fetch(registryUrl);
  if (metadataResponse.status === 404) {
    return undefined;
  }
  if (!metadataResponse.ok) {
    throw new Error(
      `npm registry returned ${metadataResponse.status} for ${descriptor.name}@${descriptor.version}.`,
    );
  }

  const metadata = (await metadataResponse.json()) as RegistryPackage;
  const tarballUrl = metadata.dist?.tarball;
  if (typeof tarballUrl !== "string" || tarballUrl.length === 0) {
    throw new Error(
      `npm metadata has no tarball for ${descriptor.name}@${descriptor.version}.`,
    );
  }

  const tarballResponse = await fetch(tarballUrl);
  if (!tarballResponse.ok) {
    throw new Error(
      `npm registry returned ${tarballResponse.status} while downloading ${descriptor.name}@${descriptor.version}.`,
    );
  }
  const tarballPath = join(
    destination,
    `published-${basename(new URL(tarballUrl).pathname)}`,
  );
  writeFileSync(tarballPath, Buffer.from(await tarballResponse.arrayBuffer()));
  return tarballPath;
}

async function inspectPackage(
  descriptor: PackageDescriptor,
  localTarball: string,
  tempDirectory: string,
): Promise<PackageState> {
  const publishedTarball = await downloadPublishedPackage(
    descriptor,
    tempDirectory,
  );
  if (publishedTarball === undefined) {
    return "missing";
  }

  const localDirectory = extractTarball(
    localTarball,
    join(tempDirectory, `${descriptor.name}-local`),
  );
  const publishedDirectory = extractTarball(
    publishedTarball,
    join(tempDirectory, `${descriptor.name}-published`),
  );
  const differences = packageContentDifference(
    localDirectory,
    publishedDirectory,
  );
  if (differences.length > 0) {
    throw new Error(
      [
        `${descriptor.name}@${descriptor.version} is already published with different contents.`,
        "Increment this package's version before releasing.",
        `Different files: ${differences.join(", ")}`,
      ].join("\n"),
    );
  }
  return "matching";
}

function publishPackage(tarballPath: string): void {
  execFileSync("npm", ["publish", tarballPath, "--access", "public"], {
    cwd: workspaceRoot,
    stdio: "inherit",
  });
}

async function release(): Promise<void> {
  const argumentsSet = new Set(process.argv.slice(2));
  const shouldPublish = argumentsSet.delete("--publish");
  if (argumentsSet.size > 0) {
    throw new Error(`Unknown arguments: ${[...argumentsSet].join(", ")}`);
  }

  const descriptors = releasePackages.map((packageConfig) => {
    const descriptor = readPackageDescriptor(packageConfig.directory);
    if (descriptor.name !== packageConfig.expectedName) {
      throw new Error(
        `Expected ${packageConfig.expectedName}, found ${descriptor.name}.`,
      );
    }
    return descriptor;
  });
  const publicVersions = descriptors.slice(2).map(({ version }) => version);
  if (new Set(publicVersions).size !== 1) {
    throw new Error(
      `wiki-graph-core, wiki-graph-sdk, and wiki-graph versions must match: ${publicVersions.join(" != ")}`,
    );
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), "wiki-graph-release-"));
  try {
    for (const [index, packageConfig] of releasePackages.entries()) {
      const descriptor = descriptors[index];
      if (descriptor === undefined) {
        throw new Error("Release package configuration is incomplete.");
      }
      const localTarball = packPackage(packageConfig.directory, tempDirectory);
      const state = await inspectPackage(
        descriptor,
        localTarball,
        tempDirectory,
      );
      if (state === "matching") {
        console.log(
          `skip ${descriptor.name}@${descriptor.version}: identical version is already published`,
        );
        continue;
      }
      if (!shouldPublish) {
        console.log(
          `plan ${descriptor.name}@${descriptor.version}: version will be published`,
        );
        continue;
      }

      console.log(`publish ${descriptor.name}@${descriptor.version}`);
      publishPackage(localTarball);
    }
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

const executableUrl =
  process.argv[1] === undefined
    ? undefined
    : pathToFileURL(resolve(process.argv[1])).href;
if (import.meta.url === executableUrl) {
  release().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
