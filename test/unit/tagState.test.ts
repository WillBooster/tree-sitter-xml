import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parser = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => parser.delete());

test('XML retains exact paired names beyond the scanner snapshot capacity', () => {
  for (const name of ['x'.repeat(1024), 'x'.repeat(2049), 'x'.repeat(65_538), 'é漢𠀀'.repeat(300)]) {
    const source = `<root><${name}>body</${name}><after/></root>`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, `name length ${name.length}`).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.childForFieldName('root')?.text).toBe(source);
      const opening = tree.rootNode.descendantsOfType('STag')[1]!.firstNamedChild!;
      const closing = tree.rootNode.descendantsOfType('ETag')[0]!.firstNamedChild!;
      expect(opening.text).toBe(name);
      expect(opening.startIndex).toBe(7);
      expect(opening.endIndex).toBe(7 + name.length);
      expect(closing.text).toBe(name);
      const closeStart = source.indexOf(`</${name}>`) + 2;
      expect(closing.startIndex).toBe(closeStart);
      expect(closing.endIndex).toBe(closeStart + name.length);
      expect(tree.rootNode.descendantsOfType('EmptyElemTag')[0]?.text).toBe('<after/>');
    } finally {
      tree.delete();
    }
  }
});

test('XML retains every name in deeply nested distinct tags', () => {
  const names = Array.from({ length: 600 }, (_, index) => `n${index}`);
  const source = `<root>${names.map((name) => `<${name}>`).join('')}body${names
    .toReversed()
    .map((name) => `</${name}>`)
    .join('')}<after/></root>`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.endIndex).toBe(source.length);
    expect(tree.rootNode.descendantsOfType('STag').map((node) => node.firstNamedChild?.text)).toEqual([
      'root',
      ...names,
    ]);
    expect(tree.rootNode.descendantsOfType('ETag').map((node) => node.firstNamedChild?.text)).toEqual([
      ...names.toReversed(),
      'root',
    ]);
    expect(tree.rootNode.descendantsOfType('EmptyElemTag')[0]?.text).toBe('<after/>');
  } finally {
    tree.delete();
  }
});

test('XML rejects long names that differ at their final character', () => {
  const prefix = 'x'.repeat(2048);
  for (const source of [`<${prefix}a></${prefix}b>`, `<root><${prefix}a>body</${prefix}b><after/></root>`]) {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  }
});

test('XML reads deep distinct nesting in linear input volume', () => {
  const reads: number[] = [];
  for (const count of [200, 2000]) {
    const names = Array.from({ length: count }, (_, index) => `n${index}`);
    const source = `<root>${names.map((name) => `<${name}>`).join('')}body${names
      .toReversed()
      .map((name) => `</${name}>`)
      .join('')}</root>`;
    let total = 0;
    const tree = parser.parse((index) => {
      total++;
      return source.slice(index, index + 64);
    })!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.descendantsOfType('STag')).toHaveLength(count + 1);
    } finally {
      tree.delete();
    }
    reads.push(total);
  }
  expect(reads[1]! / reads[0]!).toBeLessThan(18);
});
