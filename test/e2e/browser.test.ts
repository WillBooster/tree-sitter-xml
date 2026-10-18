import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';
import { expect, test } from 'vitest';

import dtdUrl from '../../tree-sitter-dtd.wasm?url';
import xmlUrl from '../../tree-sitter-xml.wasm?url';
import { ExpectedTrees } from '../fixtures/parse.js';

const Urls = { xml: xmlUrl, dtd: dtdUrl };

test.each(Object.entries(ExpectedTrees))(
  'parses with the %s grammar in a browser, loading the Wasm files over HTTP',
  async (grammar, { source, tree }) => {
    await Parser.init({ locateFile: () => runtimeUrl });
    const parser = new Parser();
    parser.setLanguage(await Language.load(Urls[grammar as keyof typeof Urls]));
    expect(parser.parse(source)?.rootNode.toString()).toBe(tree);
  }
);
