import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
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

  test(`${grammar} preserves complete processing-instruction target names and adjacent markup`, () => {
    const targets = [
      'x',
      'xm',
      'xM',
      'xmla',
      'XMLa',
      'xml-',
      'xml-modeling',
      'xml-stylesheeting',
      'XML-model',
      'Xml-stylesheet',
      'xml-model:custom',
      'xml-stylesheet𠀀',
      'xmélève',
      'xm𠀀',
      'xŭl',
      'xōl',
      'xmŬ',
    ];
    const instructions = targets.map((target) => `<?${target}?>`);
    const source = instructions.join('') + suffix;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('PITarget').map((node) => node.text)).toEqual(targets);
      expect(tree.rootNode.descendantsOfType('PI').map((node) => node.text)).toEqual(instructions);
      expect(tree.rootNode.namedChildren.at(-1)?.text).toBe(suffix);
    } finally {
      tree.delete();
    }
  });

  test(`${grammar} reserves only the exact case-insensitive xml processing-instruction target`, () => {
    for (const target of ['xml', 'xmL', 'xMl', 'xML', 'Xml', 'XmL', 'XMl', 'XML']) {
      const tree = parser.parse(`<?${target}?>${suffix}`)!;
      try {
        expect(tree.rootNode.hasError, target).toBe(true);
        expect(tree.rootNode.descendantsOfType('PITarget').map((node) => node.text)).not.toContain(target);
      } finally {
        tree.delete();
      }
    }
  });

  test(`${grammar} reports a processing instruction without a closing delimiter`, () => {
    for (const source of [`<?target first?second\n${suffix}`, '<?target first?\nsecond']) {
      const tree = parser.parse(source)!;
      expect(tree.rootNode.hasError, source).toBe(true);
      tree.delete();
    }
  });

  test(`${grammar} accepts a greater-than sign inside a processing instruction`, () => {
    const source =
      grammar === 'xml' ? `<root><?target first>second?>${suffix}</root>` : `<?target first>second?>${suffix}`;
    const tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    tree.delete();
  });
}
