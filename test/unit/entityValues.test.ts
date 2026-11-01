import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parsers: Parser[] = [];
afterAll(() => {
  for (const parser of parsers) parser.delete();
});

for (const grammar of ['xml', 'dtd']) {
  const parser = new Parser().setLanguage(
    await Language.load(`${import.meta.dirname}/../../tree-sitter-${grammar}.wasm`)
  );
  parsers.push(parser);

  test(`${grammar} preserves literal markup and references in entity replacement values`, () => {
    const contents = ["<child attr='value'>&amp;</child>", '<child attr="value">&#60;</child>'];
    const declarations = `<!ENTITY first "${contents[0]}"> <!ENTITY second '${contents[1]}'>`;
    const source = grammar === 'xml' ? `<!DOCTYPE root [${declarations} ]><root/>` : declarations;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const values = tree.rootNode.descendantsOfType('EntityValue');
      expect(values).toHaveLength(2);
      for (const [index, value] of values.entries()) {
        const content = value.childForFieldName('content')!;
        expect(content.text).toBe(contents[index]);
        expect(content.startIndex).toBe(value.startIndex + 1);
        expect(content.endIndex).toBe(value.endIndex - 1);
      }
      expect(tree.rootNode.descendantsOfType('EntityRef').map((node) => node.text)).toEqual(['&amp;']);
      expect(tree.rootNode.descendantsOfType('CharRef').map((node) => node.text)).toEqual(['&#60;']);
      if (grammar === 'xml') expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root/>');
    } finally {
      tree.delete();
    }
  });

  test(`${grammar} still rejects literal opening brackets in attribute values`, () => {
    const source = grammar === 'xml' ? '<root attr="<child/>"/>' : '<!ATTLIST root attr CDATA "<child/>">';
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  });
}
