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
[WillBooster/tree-sitter](https://github.com/WillBooster/tree-sitter) generator. The generated parsers carry ABI
`0x5742000c`, which upstream `tree-sitter` runtimes reject, and are tested and supported with `willbooster-tree-sitter`
and `@willbooster/web-tree-sitter` version 20.0.0 or later in the 20.x series. The XML scanner adapts to the generated
array API with the change upstream itself made after 0.7.0. The parsers differ from upstream's 0.7.0 packages in these
ways:

- Decoded literal text and numeric character references follow the XML 1.0 Char ranges; forbidden controls and invalid
  scalar references report errors. Malformed UTF-16 strings containing isolated surrogates are not rejected in every
  context.
- The XML scanner retains paired tag names and nesting state without truncating either to the snapshot buffer's capacity.
- Names and enumeration tokens use the [XML 1.0 Unicode character ranges](https://www.w3.org/TR/xml/#NT-NameStartChar),
  including supplementary characters, in attributes, references, and DTD declarations.
- Generic processing instructions accept multiline content and question marks up to the closing `?>`, including
  when another instruction or markup immediately follows.
- CDATA sections preserve closing-bracket runs as content and end at the first `]]>` delimiter.
- Ordinary character data rejects `]]>` while preserving bracket runs beside markup and references.
- Entity replacement values accept literal markup, including opening angle brackets.
- Internal-subset declarations may directly adjoin one another and the closing bracket.
- Parameter references are accepted between internal declarations and within external DTD declarations, but rejected
  inside internal declarations, including entity values.
- NOTATION attribute types accept one or more names separated by single pipes.
- Content-model groups reject mixed pipe/comma separators; nested groups choose separators independently.
- External DTD text declarations require encoding and permit an omitted version.
- Ignored DTD conditional sections preserve opaque text and nested section delimiters without parsing declarations.
- Attribute definitions with literal types require a default declaration.
- External DTD subsets may be empty or end immediately after a text declaration.
- Nonempty attribute values (`AttValue` and `PseudoAttValue`) and entity values (`EntityValue`) expose their full
  unquoted value through the `content` field. This field points to an anonymous `content` node wrapping text and
  references. Access references through this wrapper using the node API; references are not direct children of the
  value node. Empty values have no `content` field.

It holds two grammars, as upstream does: `xml` parses XML documents, including an internal DTD subset, and `dtd`
parses external DTD files.

## Support Scope

Valid input yields a correct tree on a full parse, and invalid input yields `ERROR` or `MISSING` nodes without
crashing, hanging, or taking more than linear time. Incremental parsing is not supported, and no queries (highlights,
locals, injections, tags) are shipped. Node types, field names, and the trees that error recovery produces may change;
such changes are released as new major versions.

## Usage

The npm package ships `tree-sitter-xml.wasm` and `tree-sitter-dtd.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter) version 20.0.0 or later in the 20.x series, which runs in Node.js, Bun, browsers, and Cloudflare Workers.
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
cargo add willbooster-tree-sitter@20.0.0 --rename tree-sitter
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
bun run verify
bun run test
cargo test
```

- Run CLI subcommands through `script/tree-sitter` so the generator and runtime match the version locked in `Cargo.lock` and `package.json`.
- Run `bun run build/ci` after editing grammars, scanners, `tree-sitter.json`, or `test/corpus/`, and commit the updated files under `xml/src/` and `dtd/src/`.
- Declare `:language(xml)` or `:language(dtd)` immediately below each `test/corpus/` case title without a blank line.
- Run `script/parse-examples` to update `script/known-failures.txt` when grammar changes or updated pins alter real-world parse results.

### References

- [Extensible Markup Language (XML) 1.0](https://www.w3.org/TR/xml/)
- [Associating Schemas with XML documents 1.0](https://www.w3.org/TR/xml-model/)
- [Associating Style Sheets with XML documents 1.0](https://www.w3.org/TR/xml-stylesheet/)
