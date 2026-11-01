import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => parser.delete());

test('XML accepts internal declarations adjacent to the closing bracket or one another', () => {
  for (const subset of [
    '<!ELEMENT root EMPTY>',
    '<!ELEMENT root EMPTY><!ELEMENT child EMPTY>',
    '<!--before--><?target data?><!ELEMENT root EMPTY>',
  ]) {
    const source = `<!DOCTYPE root [${subset}]><root/>`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, subset).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root/>');
      if (subset.startsWith('<!--')) {
        const comment = tree.rootNode.descendantsOfType('Comment')[0]!;
        expect(comment.text).toBe('<!--before-->');
        expect(comment.startIndex).toBe(source.indexOf('<!--'));
        expect(comment.endIndex).toBe(source.indexOf('-->') + 3);
        const instruction = tree.rootNode.descendantsOfType('PI')[0]!;
        expect(instruction.text).toBe('<?target data?>');
        expect(instruction.startIndex).toBe(source.indexOf('<?target'));
        expect(instruction.endIndex).toBe(source.indexOf('?>') + 2);
      }
      const declarations = tree.rootNode.descendantsOfType('elementdecl');
      const expected = subset.match(/<!ELEMENT [^>]+>/g)!;
      expect(declarations.map((node) => node.text)).toEqual(expected);
      for (const [index, node] of declarations.entries()) {
        const start = source.indexOf(expected[index]!);
        expect(node.startIndex).toBe(start);
        expect(node.endIndex).toBe(start + expected[index]!.length);
      }
    } finally {
      tree.delete();
    }
  }
});

test('XML accepts empty, whitespace-only and parameter-reference internal subsets', () => {
  for (const subset of ['', ' \t\r\n ', '<!ENTITY % decl "<!ELEMENT root EMPTY>">%decl;']) {
    const source = `<!DOCTYPE root [${subset}]><root/>`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, subset).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root/>');
      const reference = tree.rootNode.descendantsOfType('PEReference')[0];
      if (subset.includes('%decl;')) {
        expect(reference?.text).toBe('%decl;');
        expect(reference?.startIndex).toBe(source.indexOf('%decl;'));
        expect(reference?.endIndex).toBe(source.indexOf('%decl;') + 6);
      }
    } finally {
      tree.delete();
    }
  }
});

test('XML still rejects malformed or unterminated internal subsets', () => {
  for (const source of [
    '<!DOCTYPE root [<!ELEMENT root EMPTY><root/>',
    '<!DOCTYPE root [<!ELEMENT root EMPTY]><root/>',
    '<!DOCTYPE root [text]><root/>',
  ]) {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  }
});

test('XML reads many adjacent declarations in linear input volume', () => {
  const reads: number[] = [];
  for (const count of [200, 2000]) {
    const subset = Array.from({ length: count }, (_, index) => `<!ELEMENT n${index} EMPTY>`).join('');
    const source = `<!DOCTYPE root [${subset}]><root/>`;
    let total = 0;
    const tree = parser.parse((index) => {
      total++;
      return source.slice(index, index + 64);
    })!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.descendantsOfType('elementdecl')).toHaveLength(count);
    } finally {
      tree.delete();
    }
    reads.push(total);
  }
  expect(reads[1]! / reads[0]!).toBeLessThan(18);
});
