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

  test(`${grammar} preserves every name and source range in notation lists`, () => {
    for (const names of [['first'], ['first', 'second'], ['first', 'second', 'third'], ['é', '漢', '𠀀']]) {
      const list = names.join('|');
      const source = notationSource(grammar, names, list);
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, list).toBe(false);
        expect(tree.rootNode.endIndex).toBe(source.length);
        const notations = tree.rootNode.descendantsOfType('NotationType');
        expect(notations).toHaveLength(1);
        expect(notations[0]!.text).toBe(`NOTATION (${list})`);
        let position = source.indexOf(`(${list})`) + 1;
        const expected = names.map((name) => {
          const result = { text: name, start: position, end: position + name.length };
          position += name.length + 1;
          return result;
        });
        expect(
          notations[0]!.descendantsOfType('Name').map((node) => ({
            text: node.text,
            start: node.startIndex,
            end: node.endIndex,
          }))
        ).toEqual(expected);
        if (grammar === 'xml') expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root/>');
      } finally {
        tree.delete();
      }
    }
  });

  test(`${grammar} rejects notation separators without a name on both sides`, () => {
    for (const list of ['', '|first', 'first|', 'first||second', 'first second', 'first|second|']) {
      const source = notationSource(grammar, ['first', 'second'], list);
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, list).toBe(true);
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
    }
  });

  test(`${grammar} reads long notation lists in linear input volume`, () => {
    const small = notationReads(parser, grammar, 200);
    const large = notationReads(parser, grammar, 2000);
    expect(small).toBeGreaterThan(0);
    expect(large / small).toBeLessThan(18);
  });
}

function notationReads(parser: Parser, grammar: Grammar, count: number): number {
  const names = Array.from({ length: count }, (_, index) => `n${index}`);
  const source = notationSource(grammar, names, names.join('|'));
  let reads = 0;
  const tree = parser.parse((index) => {
    reads++;
    return source.slice(index, index + 64);
  })!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('NotationType')[0]!.descendantsOfType('Name')).toHaveLength(count);
  } finally {
    tree.delete();
  }
  return reads;
}

function notationSource(grammar: Grammar, names: string[], list: string): string {
  const notations = names.map((name) => `<!NOTATION ${name} SYSTEM "${name}">`).join(' ');
  const declarations = `<!ELEMENT root ANY> <!ATTLIST root choice NOTATION (${list}) #IMPLIED> ${notations}`;
  return grammar === 'xml' ? `<!DOCTYPE root [${declarations} ]><root/>` : declarations;
}
