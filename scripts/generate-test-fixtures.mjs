#!/usr/bin/env node

import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import { ZipFile } from "yazl";

const FIXTURE_MTIME = new Date("2026-01-01T00:00:00.000Z");
const FIXTURE_DIR = fileURLToPath(
  new URL("../test/fixtures/sources/", import.meta.url),
);

const TEXT_FIXTURE_PATH = join(FIXTURE_DIR, "sample-observatory-guide.txt");
const MARKDOWN_FIXTURE_PATH = join(FIXTURE_DIR, "sample-observatory-guide.md");
const EPUB_FIXTURE_PATH = join(FIXTURE_DIR, "sample-observatory-guide.epub");
const EPUB_MIXED_FIXTURE_PATH = join(
  FIXTURE_DIR,
  "sample-observatory-guide-mixed.epub",
);
const EPUB_ENCRYPTED_FIXTURE_PATH = join(
  FIXTURE_DIR,
  "sample-observatory-guide-encrypted.epub",
);
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0pUAAAAASUVORK5CYII=";

await mkdir(FIXTURE_DIR, { recursive: true });

await Promise.all([
  writeFile(TEXT_FIXTURE_PATH, buildTextFixture(), "utf8"),
  writeFile(MARKDOWN_FIXTURE_PATH, buildMarkdownFixture(), "utf8"),
  writeEpubFixture(EPUB_FIXTURE_PATH),
  writeEpubFixture(EPUB_MIXED_FIXTURE_PATH, {
    xhtmlCompressionByPath: {
      "EPUB/cover.xhtml": false,
      "EPUB/chapter-1.xhtml": true,
      "EPUB/chapter-2-log.xhtml": false,
    },
  }),
  writeEpubFixture(EPUB_ENCRYPTED_FIXTURE_PATH, {
    includeEncryptionManifest: true,
  }),
]);

console.log(`Generated fixtures in ${FIXTURE_DIR}`);

function buildTextFixture() {
  return [
    "Sample Observatory Guide",
    "",
    "05:40 bell. Mira unlatched the east hatch and logged the weather.",
    "A thin line of cloud sat above the ridge; the air smelled like iron and rain.",
    "",
    "Checklist",
    "1. Warm the lens ring for sixty seconds.",
    "2. Test the backup battery before opening the skylight.",
    "3. Record one note in English, one in 简体中文, and one in Francais.",
    "",
    "Observations",
    "- The red lamp flickered twice before stabilizing.",
    '- Nobody touched the sealed cabinet marked "Archive C".',
    "- Rainwater gathered beside the brass threshold but never crossed it.",
    "",
    'Quoted note: "Leave the door half-open if the wind rises."',
    "",
    "Closing line: After sunrise, the tower sounds less like a machine and more like a patient animal.",
    "",
  ].join("\n");
}

function buildMarkdownFixture() {
  return [
    "# Sample Observatory Guide",
    "",
    "## Route Notes",
    "",
    "The ridge path bends west at the cracked milestone and then drops toward the lower dome.",
    "",
    "> Rule zero: write for the next tired maintainer.",
    "",
    "### Repair Kit",
    "",
    "- brass compass",
    "- folded tarp",
    "- spare fuse",
    "",
    "### Signal Table",
    "",
    "| Marker | Meaning | Action |",
    "| --- | --- | --- |",
    "| two taps | battery low | switch pack |",
    "| three taps | fog rising | light beacon |",
    "",
    "```yaml",
    "beacon:",
    "  mode: pulse",
    "  retries: 2",
    "```",
    "",
    "Final note: 雨后石阶会打滑, so carry weight low and keep one hand free.",
    "",
  ].join("\n");
}

async function writeEpubFixture(
  path,
  { includeEncryptionManifest = false, xhtmlCompressionByPath = {} } = {},
) {
  await mkdir(dirname(path), { recursive: true });

  const zip = new ZipFile();
  const output = createWriteStream(path);
  const completion = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zip.outputStream.on("error", reject);
  });

  zip.outputStream.pipe(output);

  addStored(zip, "mimetype", "application/epub+zip");
  addFile(zip, "META-INF/container.xml", buildContainerXml());
  if (includeEncryptionManifest) {
    addFile(zip, "META-INF/encryption.xml", buildEncryptionXml());
  }
  addFile(zip, "EPUB/package.opf", buildPackageOpf());
  addXhtmlFile(
    zip,
    "EPUB/nav.xhtml",
    buildNavXhtml(),
    xhtmlCompressionByPath["EPUB/nav.xhtml"],
  );
  addXhtmlFile(
    zip,
    "EPUB/cover.xhtml",
    buildCoverXhtml(),
    xhtmlCompressionByPath["EPUB/cover.xhtml"],
  );
  addXhtmlFile(
    zip,
    "EPUB/chapter-1.xhtml",
    buildChapterOneXhtml(),
    xhtmlCompressionByPath["EPUB/chapter-1.xhtml"],
  );
  addXhtmlFile(
    zip,
    "EPUB/chapter-2-log.xhtml",
    buildChapterTwoXhtml(),
    xhtmlCompressionByPath["EPUB/chapter-2-log.xhtml"],
  );
  zip.addBuffer(
    Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
    "EPUB/images/cover.png",
    {
      mtime: FIXTURE_MTIME,
      mode: 0o644,
      compress: true,
    },
  );

  zip.end();

  await completion;
}

function addStored(zip, path, content) {
  zip.addBuffer(Buffer.from(content, "utf8"), path, {
    mtime: FIXTURE_MTIME,
    mode: 0o644,
    compress: false,
  });
}

function addFile(zip, path, content) {
  zip.addBuffer(Buffer.from(content, "utf8"), path, {
    mtime: FIXTURE_MTIME,
    mode: 0o644,
    compress: true,
  });
}

function addXhtmlFile(zip, path, content, compress = true) {
  zip.addBuffer(Buffer.from(content, "utf8"), path, {
    mtime: FIXTURE_MTIME,
    mode: 0o644,
    compress,
  });
}

function buildContainerXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function buildEncryptionXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:CipherData>
      <enc:CipherReference URI="EPUB/chapter-1.xhtml"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>
`;
}

function buildPackageOpf() {
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:wiki-graph:sample-observatory-guide</dc:identifier>
    <dc:title>The Pocket Observatory Manual</dc:title>
    <dc:creator>Ari Lantern</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Open Sample Press</dc:publisher>
    <dc:date>2026-01-01</dc:date>
    <dc:description>Original miniature manual created for open source integration tests.</dc:description>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2-log" href="chapter-2-log.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover-page"/>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2-log"/>
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml"/>
  </guide>
</package>
`;
}

function buildNavXhtml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head>
    <title>Navigation</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
        <li>
          <a href="chapter-1.xhtml#dawn-brief">Dawn Brief</a>
          <ol>
            <li>
              <a href="chapter-1.xhtml#maintenance-checklist">Maintenance Checklist</a>
            </li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>
`;
}

function buildCoverXhtml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Cover</title>
  </head>
  <body>
    <section>
      <h1>The Pocket Observatory Manual</h1>
      <img src="images/cover.png" alt="Minimal cover art"/>
    </section>
  </body>
</html>
`;
}

function buildChapterOneXhtml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Dawn Brief</title>
  </head>
  <body>
    <article>
      <section id="dawn-brief">
        <h1>Dawn Brief</h1>
        <p>Mira opened the shutters at 05:40 and found the mirrors dry, the brass rail cold, and the valley hidden under pale fog.</p>
        <blockquote>Count slowly, then trust the second reading.</blockquote>
      </section>
      <section id="maintenance-checklist">
        <h2>Maintenance Checklist</h2>
        <ul>
          <li>Warm the lens ring for sixty seconds.</li>
          <li>Inspect the hinge bolts for fresh rust.</li>
          <li>Write one final note: 最后一盏灯必须最后关闭。</li>
        </ul>
        <pre><code>beacon:
  phase: dawn
  retries: 2</code></pre>
      </section>
    </article>
  </body>
</html>
`;
}

function buildChapterTwoXhtml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <title>Storm Ledger</title>
  </head>
  <body>
    <article>
      <h1>Storm Ledger</h1>
      <p>The backup dome stayed sealed through the squall, but the west stair sounded hollow and should be checked before dusk.</p>
      <p>When the weather clears, compare the new readings against the paper chart stored below the radio shelf.</p>
    </article>
  </body>
</html>
`;
}
