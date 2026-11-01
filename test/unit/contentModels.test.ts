import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

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
  const sourceFor = (model: string): string => {
    const declaration = `<!ELEMENT root ${model}>`;
    return grammar === 'xml' ? `<!DOCTYPE root [${declaration} ]><root/>` : declaration;
  };

  test(`${grammar} preserves sequence, choice and nested content-model ranges`, () => {
    for (const model of ['(a)', '(a,b,c)', '(a|b|c)', '(a,(b|c)+,d?)', '((a,b)|c)*']) {
      const source = sourceFor(model);
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, model).toBe(false);
        expect(tree.rootNode.endIndex).toBe(source.length);
        const node = tree.rootNode.descendantsOfType('children')[0]!;
        expect(node.text).toBe(model);
        expect(node.startIndex).toBe(source.indexOf(model));
        expect(node.endIndex).toBe(source.indexOf(model) + model.length);
        expect(node.descendantsOfType('Name').map((name) => name.text)).toEqual(model.match(/[a-d]/g));
      } finally {
        tree.delete();
      }
    }
  });

  test(`${grammar} rejects mixed separators within one content-model group`, () => {
    for (const model of ['(a|b,c)', '(a,b|c)', '(a|b,c|d)', '(a,b|c,d)']) {
      const source = sourceFor(model);
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, model).toBe(true);
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
    }
  });

  test(`${grammar} reads long malformed content models in linear input volume`, () => {
    const reads: number[] = [];
    for (const count of [200, 2000]) {
      const model = `(${Array.from({ length: count }, (_, index) => `n${index}`).join('|')},last)`;
      const source = sourceFor(model);
      let total = 0;
      const tree = parser.parse((index) => {
        total++;
        return source.slice(index, index + 64);
      })!;
      try {
        expect(tree.rootNode.hasError).toBe(true);
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
      reads.push(total);
    }
    expect(reads[1]! / reads[0]!).toBeLessThan(18);
  });
}
