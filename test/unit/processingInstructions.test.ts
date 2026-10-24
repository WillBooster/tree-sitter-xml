import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parsers: Parser[] = [];
afterAll(() => {
  for (const parser of parsers) parser.delete();
});

for (const grammar of ['xml', 'dtd']) {
  const language = await Language.load(`${import.meta.dirname}/../../tree-sitter-${grammar}.wasm`);
  const parser = new Parser().setLanguage(language);
  parsers.push(parser);
  const suffix = grammar === 'xml' ? '<following/>' : '<!ELEMENT following EMPTY>';

  test(`${grammar} preserves complete processing instructions and their terminators`, () => {
    const instructions = [
      '<?target?>',
      '<?target ?>',
      '<?target \t?>',
      '<?target first?>',
      '<?target first?second??third?>',
      '<?target first\r\nsecond?>',
      '<?target \n?>',
    ];
    const source = instructions.join('') + suffix;
    const tree = parser.parse(source)!;
    const query = new Query(language, '(PI) @instruction');
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(instructions);
      expect(tree.rootNode.namedChildren.at(-1)?.text).toBe(suffix);
    } finally {
      query.delete();
      tree.delete();
    }
  });

  test(`${grammar} reports a processing instruction without a closing delimiter`, () => {
    const tree = parser.parse(`<?target first?second\n${suffix}`)!;
    expect(tree.rootNode.hasError).toBe(true);
    tree.delete();
  });

  test(`${grammar} completes an unfinished processing instruction after an edit at EOF`, () => {
    const source = '<?target first?\nsecond';
    const tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(true);
    const insertion = `?>${suffix}`;
    const column = 'second'.length;
    tree.edit(
      new Edit({
        startIndex: source.length,
        oldEndIndex: source.length,
        newEndIndex: source.length + insertion.length,
        startPosition: { row: 1, column },
        oldEndPosition: { row: 1, column },
        newEndPosition: { row: 1, column: column + insertion.length },
      })
    );
    const edited = source + insertion;
    const incremental = parser.parse(edited, tree)!;
    const fresh = parser.parse(edited)!;
    try {
      expect(incremental.rootNode.hasError).toBe(false);
      expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
      expect(incremental.rootNode.descendantsOfType('PI').map((node) => node.text)).toEqual([`${source}?>`]);
      expect(incremental.rootNode.namedChildren.at(-1)?.text).toBe(suffix);
    } finally {
      incremental.delete();
      fresh.delete();
      tree.delete();
    }
  });

  test(`${grammar} reparses edits that create an earlier processing-instruction terminator`, () => {
    const prefix = grammar === 'xml' ? '<root>' : '';
    const closing = grammar === 'xml' ? '</root>' : '';
    const source = `${prefix}<?target first>second?>${suffix}${closing}`;
    const startIndex = source.indexOf('>second');
    const edited = `${source.slice(0, startIndex)}?${source.slice(startIndex)}`;
    const tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    tree.edit(
      new Edit({
        startIndex,
        oldEndIndex: startIndex,
        newEndIndex: startIndex + 1,
        startPosition: { row: 0, column: startIndex },
        oldEndPosition: { row: 0, column: startIndex },
        newEndPosition: { row: 0, column: startIndex + 1 },
      })
    );
    const incremental = parser.parse(edited, tree)!;
    const fresh = parser.parse(edited)!;
    try {
      expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
      expect(incremental.rootNode.hasError).toBe(fresh.rootNode.hasError);
      expect(incremental.rootNode.descendantsOfType('PI').map((node) => node.text)).toEqual(['<?target first?>']);
      expect(
        incremental.rootNode
          .descendantsOfType(grammar === 'xml' ? 'EmptyElemTag' : 'elementdecl')
          .map((node) => node.text)
      ).toContain(suffix);
    } finally {
      incremental.delete();
      fresh.delete();
      tree.delete();
    }
  });
}
