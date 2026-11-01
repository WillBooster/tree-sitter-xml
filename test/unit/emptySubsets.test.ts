/* oxlint-disable unicorn/text-encoding-identifier-case -- XML encoding names preserve the spelling of the parsed source. */
import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const dtd = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-dtd.wasm`));
const xml = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => {
  dtd.delete();
  xml.delete();
});

test('an empty external DTD subset has an empty complete root', () => {
  const tree = dtd.parse('')!;
  try {
    expect(tree.rootNode.type).toBe('extSubset');
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.startIndex).toBe(0);
    expect(tree.rootNode.endIndex).toBe(0);
    expect(tree.rootNode.childCount).toBe(0);
    expect(tree.rootNode.startPosition).toEqual({ row: 0, column: 0 });
    expect(tree.rootNode.endPosition).toEqual({ row: 0, column: 0 });
  } finally {
    tree.delete();
  }
});

test('external subsets may end after a text declaration or contain only separators', () => {
  for (const source of [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?xml version="1.0" encoding="UTF-8"?>\n\t',
    ' \t\r\n',
    '<!--empty--><?empty?>%external;',
  ]) {
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.descendantsOfType('elementdecl')).toHaveLength(0);
      if (source.startsWith('<?xml')) {
        const declaration = tree.rootNode.descendantsOfType('TextDecl')[0]!;
        expect(declaration.text).toBe(source.trimEnd());
        expect(declaration.startIndex).toBe(0);
        expect(declaration.endIndex).toBe(source.trimEnd().length);
        expect(declaration.descendantsOfType('EncName')[0]?.text).toBe('UTF-8');
      }
      if (source.startsWith('<!--')) {
        expect(tree.rootNode.namedChildren.map((node) => node.type)).toEqual(['Comment', 'PI', 'PEReference']);
        expect(tree.rootNode.descendantsOfType('PEReference')[0]?.text).toBe('%external;');
      }
    } finally {
      tree.delete();
    }
  }
});

test('empty-subset acceptance still reports malformed trailing input and empty XML documents', () => {
  for (const source of ['garbage', '<!ELEMENT', '<!--', '%unfinished', '<?xml version="1.0" encoding="UTF-8"']) {
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  }
  const tree = xml.parse('')!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
  } finally {
    tree.delete();
  }
});
