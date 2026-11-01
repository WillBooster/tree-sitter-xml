# @willbooster/tree-sitter-xml

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-xml.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-xml)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-xml.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-xml)
[![Test](https://github.com/WillBooster/tree-sitter-xml/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-xml/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-xml/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-xml/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-21.3.0-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-xml.svg)](https://crates.io/crates/willbooster-tree-sitter-xml)

XML and DTD grammars for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter-grammars/tree-sitter-xml](https://github.com/tree-sitter-grammars/tree-sitter-xml). We are grateful
to its authors and contributors. This is not an official release of that project.

This fork builds on the grammars of upstream's version 0.7.0 and generates the parsers with the
[WillBooster/tree-sitter](https://github.com/WillBooster/tree-sitter) generator. The parsers carry that fork's own ABI
number (`0x5742000b`) and load with that fork's runtime, version 15.0.0 or later in the 15.x series. The XML scanner
adapts to the generated array API with the change upstream itself made after 0.7.0. The parsers differ from
upstream's 0.7.0 packages in these ways:

- A NUL character inside a quoted literal, such as an attribute value (`AttValue`), an entity value (`EntityValue`),
  or a system literal (`SystemLiteral`), is part of that token, where upstream's lexer reports an error.
- Where a NUL character cannot be part of any token, the `ERROR` node covers it as it covers any other unexpected
  character, without the unexpected-character node that upstream's parsers put inside it.

- Names and enumeration tokens use the [XML 1.0 Unicode character ranges](https://www.w3.org/TR/xml/#NT-NameStartChar),
  including supplementary characters, in attributes, references, and DTD declarations.
- Generic processing instructions accept multiline content and question marks up to the closing `?>`, including
  when another instruction or markup immediately follows.
- CDATA sections preserve closing-bracket runs as content and end at the first `]]>` delimiter.
- Ordinary character data rejects `]]>` while preserving bracket runs beside markup and references.
- Entity replacement values accept literal markup, including opening angle brackets.
- Parameter references are accepted between internal declarations and within external DTD declarations, but rejected
  inside internal declarations, including entity values.
- NOTATION attribute types accept one or more names separated by single pipes.
- Attribute definitions with literal types require a default declaration.
- Nonempty attribute values (`AttValue` and `PseudoAttValue`) and entity values (`EntityValue`) expose their full
  unquoted value through the `content` field. This field points to an anonymous `content` node wrapping text and
  references. Access references through this wrapper using the node API; references are not direct children of the
  value node. Empty values have no `content` field.

It holds two grammars, as upstream does: `xml` parses XML documents, including an internal DTD subset, and `dtd`
parses external DTD files.

## Support Scope

This fork maintains only full parsing: valid input yields a correct tree, and invalid input yields `ERROR` or `MISSING`
nodes without crashing, hanging, or taking more than linear time. Incremental parsing works as in upstream tree-sitter
but is not tested here, and no queries (highlights, locals, injections, tags) are shipped. Node types, field names, and
the trees that error recovery produces may change; such changes are released as new major versions.

## Usage

The npm package ships `tree-sitter-xml.wasm` and `tree-sitter-dtd.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter) version 15.0.0 or later in the 15.x series, which runs in Node.js, Bun, browsers, and Cloudflare Workers.
In Node.js and Bun, load the grammar from its path:

```js
import { fileURLToPath } from 'node:url';

import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const parser = new Parser();
const wasmPath = fileURLToPath(import.meta.resolve('@willbooster/tree-sitter-xml/tree-sitter-xml.wasm'));
parser.setLanguage(await Language.load(wasmPath));
const tree = parser.parse('<?xml version="1.0"?>\n<note><to>Tove</to></note>\n');
```

In browsers, serve both `.wasm` files and load them by URL (the example uses Vite's `?url` imports):

```js
import xmlUrl from '@willbooster/tree-sitter-xml/tree-sitter-xml.wasm?url';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';

await Parser.init({ locateFile: () => runtimeUrl });
const parser = new Parser();
parser.setLanguage(await Language.load(xmlUrl));
```

Cloudflare Workers do not allow compiling Wasm at run time, so import both `.wasm` files as modules, with or without
Node.js compatibility:

```js
import xml from '@willbooster/tree-sitter-xml/tree-sitter-xml.wasm';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtime from '@willbooster/web-tree-sitter/web-tree-sitter.wasm';

await Parser.init({ wasmModule: runtime });
const parser = new Parser();
parser.setLanguage(await Language.load(xml));
```

The package also ships the grammar definitions (`common/common.mjs`, `xml/grammar.js`, and `dtd/grammar.js`, with the
`package.json` files that mark the latter two as ES modules) and the node types in
`xml/src/node-types.json` and `dtd/src/node-types.json`.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-xml) and on
[willbooster-tree-sitter](https://crates.io/crates/willbooster-tree-sitter), the runtime this package is tested and
fuzzed with:

```sh
cargo add willbooster-tree-sitter@15.0.0 --rename tree-sitter
cargo add willbooster-tree-sitter-xml --rename tree-sitter-xml
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_xml::LANGUAGE_XML.into())?;
```

`tree_sitter_xml::LANGUAGE_DTD` is the `dtd` grammar. The crate also exports upstream's `XML_NODE_TYPES` and
`DTD_NODE_TYPES`, but not upstream's query constants `XML_HIGHLIGHT_QUERY` and `DTD_HIGHLIGHT_QUERY`.

## Development

```sh
mise install
bun install --frozen-lockfile
bun run test/ci-setup # installs Chromium for the browser test
bun run build/ci
bun run test
script/parse-examples
cargo test
```

The scripts and tests generate, build, test, and parse with `script/tree-sitter`, the tree-sitter CLI of the
WillBooster/tree-sitter runtime version locked in `Cargo.lock`, since the generator and the runtime of upstream's CLI are
not the ones this package ships with. Its first run downloads that CLI from the runtime's GitHub Release, or builds it
with `cargo` (whose build runs the CMake that `mise.toml` pins) when the download fails or the release has no binary that runs here. Run other CLI commands through it as
well (e.g. `script/tree-sitter parse --grammar-path xml file.xml`).

`bun run generate` records a fresh generation profile for each grammar from the `test/corpus` cases of that grammar,
then generates compact parser tables. It would also profile files tracked in `examples/`, but this repository tracks
none. The corpus is upstream's, with the blank line between each case's name and its attributes removed, since the
WillBooster/tree-sitter CLI, like upstream's current CLI, reads no case whose header has one, plus
`null-characters.txt`, which pins this parser's reading of NUL characters. The parsers also embed metadata from
`tree-sitter.json`. After changing a grammar, `tree-sitter.json`, or a corpus case, regenerate and commit `xml/src/`
and `dtd/src/`. Profiles in `.tmp/generation-profiles/` are temporary and must not be committed. `bun run build-wasm`,
`bun run build/ci`, and the release build regenerate the parsers before compiling them.

`bun run test` runs:

- the corpus in `test/corpus`, with the native build and with the Wasm build (the first run downloads the WASI SDK).
  Each case names its grammar with `:language(xml)` or `:language(dtd)`;
- a check that the real-world files in `examples/` fail to parse exactly as listed in `script/known-failures.txt`, each
  parsed with the grammar its extension belongs to in `tree-sitter.json`. The first run clones the repositories. The
  example repositories are pinned to commits in `script/parse-examples`. After a grammar change or a moved pin alters
  that list, `script/parse-examples` rewrites it; review its diff before committing;
- a performance check (`test/unit/performance.test.ts`) that recovering from an error on each line takes linear
  time with both grammars, since consumers parse files while they are being edited. It loads the Wasm builds through
  @willbooster/web-tree-sitter, which `bun run build/ci` rebuilds after regenerating the parsers;
- a check (`test/unit/runtimeVersion.test.ts`) that `@willbooster/web-tree-sitter` in `package.json` and
  `willbooster-tree-sitter` in `Cargo.lock` are the same version, since the Wasm tests run on the former and the Rust
  tests, the fuzzer, and the CLI on the latter;
- tests that load the Wasm builds with @willbooster/web-tree-sitter in Chromium (`test/e2e/browser.test.ts`) and in
  Cloudflare Workers with and without Node.js compatibility (`test/e2e/workers.test.ts`).

The tests compile the parsers into `.tmp/tree-sitter-lib` rather than the CLI's cache shared by every checkout;
`script/parse-examples` builds parsers of its own in `.tmp/` for each run and deletes them afterwards.

CI also runs these tests on Linux arm64 and macOS, where the CLI compiles the parsers and the scanners natively, and
fuzzes both parsers with libFuzzer and sanitizers (`.github/workflows/robustness.yml`).

### References

- [Extensible Markup Language (XML) 1.0](https://www.w3.org/TR/xml/)
- [Associating Schemas with XML documents 1.0](https://www.w3.org/TR/xml-model/)
- [Associating Style Sheets with XML documents 1.0](https://www.w3.org/TR/xml-stylesheet/)
