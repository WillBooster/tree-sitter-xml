import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

type Grammar = 'xml' | 'dtd';

await Parser.init();
const parsers: Parser[] = [];
afterAll(() => {
  for (const parser of parsers) parser.delete();
});

for (const grammar of ['xml', 'dtd'] as const) {
  const parser = new Parser().setLanguage(
    await Language.load(`${import.meta.dirname}/../../tree-sitter-${grammar}.wasm`)
  );
  parsers.push(parser);

  test(`${grammar} preserves required, implied, fixed and literal default declarations`, () => {
    const attributes = [
      ['mandatory', 'CDATA', '#REQUIRED'],
      ['optional', 'CDATA', '#IMPLIED'],
      ['fixed', 'CDATA', '#FIXED "fixed"'],
      ['plain', 'CDATA', '"plain"'],
      ['single', 'CDATA', "'single'"],
      ['enumerated', '(one|two)', '"one"'],
      ['notation', 'NOTATION (first)', '#IMPLIED'],
    ] as const;
    const definitions = attributes.map((attribute) => attribute.join(' ')).join(' ');
    const source = defaultSource(grammar, definitions);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const nodes = tree.rootNode.descendantsOfType('AttDef');
      expect(nodes).toHaveLength(attributes.length);
      for (const [index, node] of nodes.entries()) {
        const [name, , clause] = attributes[index]!;
        expect(node.firstNamedChild?.text).toBe(name);
        const defaults = node.descendantsOfType('DefaultDecl');
        expect(defaults).toHaveLength(1);
        expect(defaults[0]!.text).toBe(clause);
        const start = source.indexOf(clause, node.startIndex);
        expect(defaults[0]!.startIndex).toBe(start);
        expect(defaults[0]!.endIndex).toBe(start + clause.length);
      }
      if (grammar === 'xml') expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root mandatory="present"/>');
    } finally {
      tree.delete();
    }
  });

  test(`${grammar} rejects an attribute definition without a default declaration`, () => {
    for (const type of ['CDATA', 'ID', '(one|two)', 'NOTATION (first)']) {
      const source = defaultSource(grammar, `value ${type}`);
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, type).toBe(true);
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
    }
  });

  if (grammar === 'dtd') {
    test('dtd accepts a parameter entity supplying a combined type and default', () => {
      const source = '<!ELEMENT root ANY> <!ENTITY % tail "CDATA #IMPLIED"> <!ATTLIST root value %tail;>';
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.endIndex).toBe(source.length);
        const references = tree.rootNode.descendantsOfType('PEReference');
        expect(references.map((node) => node.text)).toEqual(['%tail;']);
        expect(references[0]!.startIndex).toBe(source.indexOf('%tail;'));
        expect(references[0]!.endIndex).toBe(source.indexOf('%tail;') + '%tail;'.length);
      } finally {
        tree.delete();
      }
    });
  }

  test(`${grammar} reads repeated missing defaults in linear input volume`, () => {
    const small = missingDefaultReads(parser, grammar, 200);
    const large = missingDefaultReads(parser, grammar, 2000);
    expect(small).toBeGreaterThan(0);
    expect(large / small).toBeLessThan(18);
  });
}

function missingDefaultReads(parser: Parser, grammar: Grammar, count: number): number {
  const definitions = Array.from({ length: count }, (_, index) => `value${index} CDATA`).join(' ');
  const source = defaultSource(grammar, definitions);
  let reads = 0;
  const tree = parser.parse((index) => {
    reads++;
    return source.slice(index, index + 64);
  })!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.endIndex).toBe(source.length);
  } finally {
    tree.delete();
  }
  return reads;
}

function defaultSource(grammar: Grammar, definitions: string): string {
  const declarations = `<!ELEMENT root ANY> <!ATTLIST root ${definitions}> <!NOTATION first SYSTEM "first">`;
  return grammar === 'xml' ? `<!DOCTYPE root [${declarations} ]><root mandatory="present"/>` : declarations;
}
