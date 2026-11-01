/* oxlint-disable unicorn/text-encoding-identifier-case -- XML encoding names are source text whose spelling and ranges must be preserved. */
import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const dtd = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-dtd.wasm`));
const xml = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => {
  dtd.delete();
  xml.delete();
});

test('DTD text declarations require encoding and permit an omitted version', () => {
  for (const declaration of [
    '<?xml encoding="UTF-8"?>',
    "<?xml encoding='UTF-8' ?>",
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<?xml version='1.0' encoding='UTF-8' ?>",
  ]) {
    const source = `${declaration}\n<!ELEMENT root EMPTY>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, declaration).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const node = tree.rootNode.descendantsOfType('TextDecl')[0]!;
      expect(node.text).toBe(declaration);
      expect(node.startIndex).toBe(0);
      expect(node.endIndex).toBe(declaration.length);
      const encoding = node.descendantsOfType('EncName')[0]!;
      expect(encoding.text).toBe('UTF-8');
      expect(encoding.startIndex).toBe(declaration.indexOf('UTF-8'));
      expect(encoding.endIndex).toBe(declaration.indexOf('UTF-8') + 5);
      expect(node.descendantsOfType('VersionNum').map((version) => version.text)).toEqual(
        declaration.includes('version') ? ['1.0'] : []
      );
      expect(tree.rootNode.descendantsOfType('elementdecl')[0]?.text).toBe('<!ELEMENT root EMPTY>');
    } finally {
      tree.delete();
    }
  }
});

test('DTD rejects text declarations without an encoding', () => {
  for (const declaration of ['<?xml version="1.0"?>', "<?xml version='1.0' ?>", '<?xml?>']) {
    const source = `${declaration}\n<!ELEMENT root EMPTY>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, declaration).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  }
});

test('XML document declarations still require a version and permit omitted encoding', () => {
  for (const [declaration, error] of [
    ['<?xml version="1.0"?>', false],
    ['<?xml version="1.0" encoding="UTF-8"?>', false],
    ['<?xml encoding="UTF-8"?>', true],
  ] as const) {
    const source = `${declaration}<root/>`;
    const tree = xml.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(error);
      expect(tree.rootNode.endIndex).toBe(source.length);
      if (!error) expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root/>');
    } finally {
      tree.delete();
    }
  }
});

test('DTD reads unterminated text-declaration values in linear input volume', () => {
  const reads: number[] = [];
  for (const count of [200, 2000]) {
    const source = `<?xml encoding="${'U'.repeat(count)}`;
    let total = 0;
    const tree = dtd.parse((index) => {
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
