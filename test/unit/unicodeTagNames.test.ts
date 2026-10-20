import { afterAll, expect, test } from 'vitest';

import { Edit, Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => parser.delete());

for (const [opening, closing] of [
  ['é', 'ǩ'],
  ['Ā', 'Ȁ'],
  ['𠀀', '𠄀'],
  ['漢', '瀢'],
  ['à', 'á'],
] as const) {
  test(`distinguishes ${opening} from ${closing} in closing tags after edits`, () => {
    const source = `<root><${opening}></${opening}><following/></root>`;
    const edited = `<root><${opening}></${closing}><following/></root>`;
    const tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('EmptyElemTag').map((node) => node.text)).toContain('<following/>');

    const startIndex = source.indexOf(`</${opening}>`) + 2;
    tree.edit(
      new Edit({
        startIndex,
        oldEndIndex: startIndex + opening.length,
        newEndIndex: startIndex + closing.length,
        startPosition: { row: 0, column: startIndex },
        oldEndPosition: { row: 0, column: startIndex + opening.length },
        newEndPosition: { row: 0, column: startIndex + closing.length },
      })
    );
    const incremental = parser.parse(edited, tree)!;
    const fresh = parser.parse(edited)!;
    expect(fresh.rootNode.hasError).toBe(true);
    expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
    expect(incremental.rootNode.descendantsOfType('EmptyElemTag').map((node) => node.text)).toContain('<following/>');
    fresh.delete();
    incremental.delete();
    tree.delete();
  });
}

for (const [character, counts] of [
  ['é', [127, 128, 129, 500]],
  ['漢', [84, 85, 86, 333]],
  ['𠀀', [63, 64, 65, 250]],
] as const) {
  for (const count of counts) {
    test(`preserves a ${count}-character ${character} tag across scanner restoration`, () => {
      const name = character.repeat(count);
      const source = `<root><${name}><child/></${name}><following/></root>`;
      const tree = parser.parse(source)!;
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('EmptyElemTag').map((node) => node.text)).toEqual([
        '<child/>',
        '<following/>',
      ]);
      const mismatched = source.replace(`</${name}>`, `</${name.slice(0, -character.length)}x>`);
      const invalid = parser.parse(mismatched)!;
      expect(invalid.rootNode.hasError).toBe(true);
      invalid.delete();
      tree.delete();
    });
  }
}

test('requires a name-start character before combining marks or digits', () => {
  for (const name of ['1name', '̀name', '\u{F0000}']) {
    const tree = parser.parse(`<root><${name}/><following/></root>`)!;
    expect(tree.rootNode.hasError).toBe(true);
    tree.delete();
  }
});

test('accepts combining continuations and the supplementary name-start upper bound', () => {
  for (const name of ['à', '\u{EFFFF}']) {
    const tree = parser.parse(`<root><${name}></${name}><following/></root>`)!;
    expect(tree.rootNode.hasError).toBe(false);
    tree.delete();
  }
});

for (const depth of [339, 400, 507]) {
  test(`preserves matching short-name elements at depth ${depth}`, () => {
    const source = '<a>'.repeat(depth) + '</a>'.repeat(depth);
    const tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('STag')).toHaveLength(depth);
    expect(tree.rootNode.descendantsOfType('ETag')).toHaveLength(depth);
    tree.delete();
  });
}
