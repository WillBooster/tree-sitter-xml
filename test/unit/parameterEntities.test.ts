import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parsers: Parser[] = [];
afterAll(() => {
  for (const parser of parsers) parser.delete();
});

const declarations = [
  '<!ENTITY % item "child"> <!ELEMENT %item; EMPTY>',
  '<!ENTITY % model "EMPTY"> <!ELEMENT root %model;>',
  '<!ENTITY % member "child"> <!ELEMENT root (%member;)>',
  '<!ENTITY % attribute "value"> <!ATTLIST root %attribute; CDATA #IMPLIED>',
  '<!ENTITY % type "CDATA"> <!ATTLIST root value %type; #IMPLIED>',
  '<!ENTITY % default "#IMPLIED"> <!ATTLIST root value CDATA %default;>',
  '<!ENTITY % word "a"> <!ENTITY text "%word;">',
  '<!ENTITY % kind "PUBLIC"> <!NOTATION note %kind; "identifier">',
  '<!ENTITY % mixed "#PCDATA"> <!ELEMENT root (%mixed;)>',
];

for (const grammar of ['xml', 'dtd'] as const) {
  const parser = new Parser().setLanguage(
    await Language.load(`${import.meta.dirname}/../../tree-sitter-${grammar}.wasm`)
  );
  parsers.push(parser);
  test(`${grammar} enforces parameter-reference positions in declarations`, () => {
    for (const declaration of declarations) {
      const source = grammar === 'xml' ? `<!DOCTYPE root [${declaration} ]><root/>` : declaration;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, declaration).toBe(grammar === 'xml');
        expect(tree.rootNode.endIndex).toBe(source.length);
        if (grammar === 'dtd') {
          const reference = tree.rootNode.descendantsOfType('PEReference')[0]!;
          const text = declaration.match(/%[a-z]+;/)![0];
          expect(reference.text).toBe(text);
          expect(reference.startIndex).toBe(source.indexOf(text));
          expect(reference.endIndex).toBe(source.indexOf(text) + text.length);
        }
      } finally {
        tree.delete();
      }
    }
  });

  test(`${grammar} reads repeated parameter references in linear input volume`, () => {
    const reads: number[] = [];
    for (const count of [200, 2000]) {
      const entries = Array.from({ length: count }, (_, index) => `<!ELEMENT n${index} %model;>`).join(' ');
      const declarations = `<!ENTITY % model "EMPTY"> ${entries}`;
      const source = grammar === 'xml' ? `<!DOCTYPE root [${declarations} ]><root/>` : declarations;
      let total = 0;
      const tree = parser.parse((index) => {
        total++;
        return source.slice(index, index + 64);
      })!;
      try {
        expect(tree.rootNode.hasError).toBe(grammar === 'xml');
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
      reads.push(total);
    }
    expect(reads[1]! / reads[0]!).toBeLessThan(18);
  });
}

test('XML preserves parameter declarations and references between declarations', async () => {
  const parser = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
  parsers.push(parser);
  const source = '<!DOCTYPE root [<!ENTITY % decl "<!ELEMENT root EMPTY>">%decl;]><root/>';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.endIndex).toBe(source.length);
    expect(tree.rootNode.childForFieldName('root')?.text).toBe('<root/>');
    const reference = tree.rootNode.descendantsOfType('PEReference')[0]!;
    expect(reference.text).toBe('%decl;');
    expect(reference.startIndex).toBe(source.indexOf('%decl;'));
    expect(reference.endIndex).toBe(source.indexOf('%decl;') + 6);
  } finally {
    tree.delete();
  }
});

test('XML preserves percent text in attributes, comments and system literals', async () => {
  const parser = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
  parsers.push(parser);
  const source =
    '<!DOCTYPE root [<!ELEMENT root EMPTY> <!ENTITY text "&#37;word;"> <!NOTATION note SYSTEM "%word;"> <!--%word;--> ]><root value="%word;"/>';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.endIndex).toBe(source.length);
    expect(tree.rootNode.descendantsOfType('PEReference')).toHaveLength(0);
    expect(tree.rootNode.descendantsOfType('AttValue')[0]?.text).toBe('"%word;"');
    expect(tree.rootNode.descendantsOfType('EntityValue')[0]?.text).toBe('"&#37;word;"');
  } finally {
    tree.delete();
  }
});
