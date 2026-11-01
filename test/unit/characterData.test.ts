import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => parser.delete());

test('rejects a CDATA closing delimiter anywhere in ordinary character data', () => {
  for (const content of [']]>', ']]]>', ']]]]>', 'prefix]]>', 'prefix]]]>', '漢]]>', '\n]]>']) {
    const source = `<root>${content}<following/></root>`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, content).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.descendantsOfType('EmptyElemTag').map((node) => node.text)).toContain('<following/>');
    } finally {
      tree.delete();
    }
  }
});

test('preserves bracket text and source boundaries next to markup and references', () => {
  for (const content of ['>', ']', ']]', ']]]', 'prefix]]x', 'x]y]z', '] ]>', ']>]', '漢]]]🙂']) {
    const source = `<root>${content}<following/>tail</root>`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, content).toBe(false);
      expect(tree.rootNode.childForFieldName('root')?.type).toBe('element');
      expect(
        tree.rootNode.descendantsOfType('CharData').map((node) => ({
          text: node.text,
          start: node.startIndex,
          end: node.endIndex,
        }))
      ).toEqual([
        { text: content, start: 6, end: 6 + content.length },
        { text: 'tail', start: 6 + content.length + '<following/>'.length, end: source.length - '</root>'.length },
      ]);
      expect(tree.rootNode.descendantsOfType('EmptyElemTag').map((node) => node.text)).toEqual(['<following/>']);
    } finally {
      tree.delete();
    }
  }
  const tree = parser.parse('<root>]]&amp;]]<following/></root>')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('CharData').map((node) => node.text)).toEqual([']]', ']]']);
    expect(tree.rootNode.descendantsOfType('EntityRef').map((node) => node.text)).toEqual(['&amp;']);
  } finally {
    tree.delete();
  }
});

test('reads repeated forbidden delimiters in linear input volume', () => {
  const small = delimiterReads(200);
  const large = delimiterReads(2000);
  expect(small).toBeGreaterThan(0);
  expect(large / small).toBeLessThan(18);
});

function delimiterReads(count: number): number {
  const source = `<root>${']]>\n'.repeat(count)}<following/></root>`;
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
