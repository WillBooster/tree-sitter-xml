import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const xml = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
const dtd = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-dtd.wasm`));
afterAll(() => {
  xml.delete();
  dtd.delete();
});

const xmlLiteralSources = (char: string): string[] => [
  `<root>x${char}y</root>`,
  `<root value="x${char}y"/>`,
  `<root><![CDATA[x${char}y]]></root>`,
  `<root><?data ${char}y?></root>`,
  `<root><!--x${char}y--></root>`,
  `<!DOCTYPE root SYSTEM "x${char}y"><root/>`,
  `<!DOCTYPE root [<!ENTITY e "x${char}y"> ]><root/>`,
];
const dtdLiteralSources = (char: string): string[] => [
  `<!ENTITY e "x${char}y">`,
  `<!ATTLIST root value CDATA "x${char}y">`,
  `<!NOTATION n SYSTEM "x${char}y">`,
  `<?data ${char}y?>`,
  `<!--x${char}y-->`,
];

test('forbidden literal characters report errors in every XML and DTD text context', () => {
  for (const codePoint of [0, 1, 8, 0xb, 0xc, 0xe, 0x1f, 0xff_fe, 0xff_ff]) {
    const char = String.fromCodePoint(codePoint);
    for (const [parser, sources] of [
      [xml, xmlLiteralSources(char)],
      [dtd, dtdLiteralSources(char)],
    ] as const) {
      for (const source of sources) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, `U+${codePoint.toString(16)} in ${source}`).toBe(true);
          expect(tree.rootNode.endIndex).toBe(source.length);
        } finally {
          tree.delete();
        }
      }
    }
  }
});

test('legal character boundaries preserve literal content and ranges', () => {
  for (const codePoint of [9, 10, 13, 0x20, 0xd7_ff, 0xe0_00, 0xff_fd, 0x1_00_00, 0x10_ff_ff]) {
    const char = String.fromCodePoint(codePoint);
    const source = `<root value="${char}">before${char}after<![CDATA[${char}]]><?data ${char}?><!--${char}--></root>`;
    const tree = xml.parse(source)!;
    try {
      expect(tree.rootNode.hasError, `U+${codePoint.toString(16)}`).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const value = tree.rootNode.descendantsOfType('AttValue')[0]!.childForFieldName('content')!;
      expect(value.text).toBe(char);
      expect(value.startIndex).toBe('<root value="'.length);
      expect(value.endIndex).toBe('<root value="'.length + char.length);
      expect(tree.rootNode.descendantsOfType('CData')[0]?.text).toBe(char);
      expect(tree.rootNode.descendantsOfType('CharData')[0]?.text).toBe(`before${char}after`);
    } finally {
      tree.delete();
    }
    for (const source of dtdLiteralSources(char)) {
      const tree = dtd.parse(source)!;
      try {
        expect(tree.rootNode.hasError, `U+${codePoint.toString(16)} in ${source}`).toBe(false);
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
    }
  }
});

const referenceSources = (reference: string): readonly (readonly [Parser, string])[] =>
  [
    [xml, `<root>${reference}</root>`],
    [xml, `<root value="${reference}"/>`],
    [dtd, `<!ENTITY e "${reference}">`],
    [dtd, `<!ATTLIST root value CDATA "${reference}">`],
  ] as const;

test('numeric references reject forbidden code points, overflow, and missing digits', () => {
  for (const reference of [
    '&#0;',
    '&#x0;',
    '&#8;',
    '&#11;',
    '&#x1F;',
    '&#xD800;',
    '&#xDFFF;',
    '&#xFFFE;',
    '&#xFFFF;',
    '&#x110000;',
    '&#1114112;',
    '&#999999999999999999999999;',
    '&#xFFFFFFFFFFFFFFFFFFFFFFFF;',
    '&#;',
    '&#x;',
  ]) {
    for (const [parser, source] of referenceSources(reference)) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
        expect(tree.rootNode.endIndex).toBe(source.length);
      } finally {
        tree.delete();
      }
    }
  }
});

test('legal decimal and hexadecimal references expose exact text and ranges', () => {
  for (const reference of [
    '&#9;',
    '&#10;',
    '&#13;',
    '&#32;',
    '&#55295;',
    '&#57344;',
    '&#65533;',
    '&#65536;',
    '&#1114111;',
    '&#x10FFFF;',
    '&#x0009;',
    '&#0000000000009;',
    '&#xFDD0;',
  ]) {
    for (const [parser, source] of referenceSources(reference)) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.endIndex).toBe(source.length);
        const references = tree.rootNode.descendantsOfType('CharRef');
        expect(references).toHaveLength(1);
        expect(references[0]!.text).toBe(reference);
        expect(references[0]!.startIndex).toBe(source.indexOf(reference));
        expect(references[0]!.endIndex).toBe(source.indexOf(reference) + reference.length);
      } finally {
        tree.delete();
      }
    }
  }
});

test('reference-like literal text is not expanded in CDATA, comments, instructions or system literals', () => {
  for (const [parser, source] of [
    [xml, '<root><![CDATA[&#0;]]><!--&#xD800;--><?data &#x110000;?></root>'],
    [dtd, '<!NOTATION n SYSTEM "&#0;"><!--&#xD800;--><?data &#x110000;?>'],
  ] as const) {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.descendantsOfType('CharRef')).toHaveLength(0);
    } finally {
      tree.delete();
    }
  }
});

test('forbidden characters and overflowing numeric references have linear input reads', () => {
  for (const parser of [xml, dtd]) {
    for (const form of ['controls', 'digits', 'instruction', 'comment'] as const) {
      const reads: number[] = [];
      for (const count of [200, 2000]) {
        const content =
          form === 'controls'
            ? 'x\0'.repeat(count)
            : form === 'digits'
              ? `&#${'9'.repeat(count)};`
              : form === 'instruction'
                ? `${'<?data '.repeat(count)}\0?>`
                : `<!--${'x'.repeat(count)}\0-->`;
        const source =
          parser === xml
            ? `<root>${content}</root>`
            : form === 'instruction' || form === 'comment'
              ? content
              : `<!ENTITY e "${content}">`;
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
      expect(reads[1]! / reads[0]!, form).toBeLessThan(18);
    }
  }
});

test('entity replacement text preserves markup-looking literals and character references', () => {
  for (const quote of ['"', "'"]) {
    for (const content of ['<!---->', '<!--literal--><?data text?>', '&#37;word;<!---->']) {
      const declaration = `<!ENTITY e ${quote}${content}${quote}>`;
      for (const [parser, source] of [
        [xml, `<!DOCTYPE root [${declaration}]><root/>`],
        [dtd, declaration],
      ] as const) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.endIndex).toBe(source.length);
          const value = tree.rootNode.descendantsOfType('EntityValue')[0]!;
          const literal = value.childForFieldName('content')!;
          expect(literal.text).toBe(content);
          expect(literal.startIndex).toBe(source.indexOf(quote) + 1);
          expect(literal.endIndex).toBe(source.indexOf(quote) + 1 + content.length);
          expect(value.descendantsOfType(['Comment', 'PI'])).toHaveLength(0);
          expect(value.descendantsOfType('CharRef').map((node) => node.text)).toEqual(
            content.startsWith('&#37;') ? ['&#37;'] : []
          );
        } finally {
          tree.delete();
        }
      }
    }
  }
});
