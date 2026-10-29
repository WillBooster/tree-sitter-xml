import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const parsers: Parser[] = [];
afterAll(() => {
  for (const parser of parsers) parser.delete();
});

const fixtures = {
  xml: {
    source:
      '<!DOCTYPE café [\n<!ENTITY élève "value">\n<!ATTLIST café état (prêt|𠀀|̀|1) #IMPLIED>\n]><café donnée="&élève;" à="value" a‿="x" 𠀀="supplementary">&élève;<following/></café>',
    names: [
      'café',
      'élève',
      'café',
      'état',
      'prêt',
      '𠀀',
      '̀',
      '1',
      'café',
      'donnée',
      'élève',
      'à',
      'a‿',
      '𠀀',
      'élève',
      'following',
      'café',
    ],
  },
  dtd: {
    source:
      '<!ELEMENT café EMPTY>\n<!ATTLIST café état (prêt|𠀀|̀|1) #IMPLIED>\n<!ENTITY élève "value">\n<!ENTITY % modèle "">%modèle;',
    names: ['café', 'café', 'état', 'prêt', '𠀀', '̀', '1', 'élève', 'modèle', 'modèle'],
  },
};

for (const grammar of ['xml', 'dtd'] as const) {
  const language = await Language.load(`${import.meta.dirname}/../../tree-sitter-${grammar}.wasm`);
  const parser = new Parser().setLanguage(language);
  parsers.push(parser);

  test(`${grammar} exposes complete Unicode names and Nmtokens at their source ranges`, () => {
    const { source, names } = fixtures[grammar];
    const tree = parser.parse(source)!;
    const query = new Query(language, '(Name) @name\n(Nmtoken) @name');
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const captures = query.captures(tree.rootNode);
      expect(captures.map(({ node }) => node.text)).toEqual(names);
      for (const { node } of captures) {
        expect(source.slice(node.startIndex, node.endIndex)).toBe(node.text);
        const prefix = source.slice(0, node.startIndex).split('\n');
        expect(node.startPosition).toEqual({ row: prefix.length - 1, column: prefix.at(-1)!.length });
      }
    } finally {
      query.delete();
      tree.delete();
    }
  });

  test(`${grammar} rejects illegal name starts and characters outside the XML name ranges`, () => {
    for (const name of ['1name', '̀name', '·name', ';name', 'name\u3000x', '\u{F0000}']) {
      const source = grammar === 'xml' ? `<root ${name}="value"/>` : `<!ELEMENT ${name} EMPTY>`;
      const tree = parser.parse(source)!;
      expect(tree.rootNode.hasError, source).toBe(true);
      tree.delete();
    }
  });
}
