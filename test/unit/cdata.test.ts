import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => parser.delete());

test('preserves CDATA content and delimiter ranges across closing-bracket runs', () => {
  const contents = ['', ']', ']]', ']]]', 'a]', 'a]]', 'a]]]', ']x', ']]x', ']]]x', '<&>漢\n]]'];
  const sections = contents.map((content) => `<![CDATA[${content}]]>`);
  const source = `<root>${sections.join('')}<following/></root>`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const root = tree.rootNode.childForFieldName('root')!;
    expect(root.type).toBe('element');
    expect(root.text).toBe(source);
    const nodes = root.descendantsOfType('CDSect');
    expect(nodes.map((node) => node.text)).toEqual(sections);
    let offset = '<root>'.length;
    for (const [index, node] of nodes.entries()) {
      expect(node.startIndex).toBe(offset);
      expect(node.endIndex).toBe(offset + sections[index]!.length);
      expect(node.firstNamedChild?.type).toBe('CDStart');
      expect(node.firstNamedChild?.text).toBe('<![CDATA[');
      expect(
        node.descendantsOfType('CData').map((content) => ({
          text: content.text,
          start: content.startIndex,
          end: content.endIndex,
        }))
      ).toEqual(
        contents[index]
          ? [
              {
                text: contents[index],
                start: offset + '<![CDATA['.length,
                end: offset + sections[index]!.length - ']]>'.length,
              },
            ]
          : []
      );
      offset += sections[index]!.length;
    }
    expect(root.descendantsOfType('EmptyElemTag').map((node) => node.text)).toEqual(['<following/>']);
  } finally {
    tree.delete();
  }
});

test('reports unterminated CDATA with closing brackets', () => {
  for (const content of ['', ']', ']]', 'a]]]', ']]]x']) {
    const tree = parser.parse(`<root><![CDATA[${content}`)!;
    try {
      expect(tree.rootNode.hasError, content).toBe(true);
    } finally {
      tree.delete();
    }
  }
});

test('reads long CDATA bracket runs in linear input volume', () => {
  const small = readsFor(2000);
  const large = readsFor(20_000);
  expect(small).toBeGreaterThan(0);
  expect(large / small).toBeLessThan(18);
});

function readsFor(length: number): number {
  const content = ']'.repeat(length);
  const source = `<root><![CDATA[${content}]]><following/></root>`;
  let reads = 0;
  const tree = parser.parse((index) => {
    reads++;
    return source.slice(index, index + 64);
  })!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('CData').map((node) => node.text)).toEqual([content]);
  } finally {
    tree.delete();
  }
  return reads;
}
