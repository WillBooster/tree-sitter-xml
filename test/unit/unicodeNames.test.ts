import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
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

  test(`${grammar} preserves names and following markup across supplementary-character edits`, () => {
    const prefix = grammar === 'xml' ? '<root ' : '<!ATTLIST root ';
    const suffix = grammar === 'xml' ? '="value"><following/></root>' : ' CDATA #IMPLIED><!ELEMENT following EMPTY>';
    let name = 'donnée';
    const source = `${prefix}${name}${suffix}`;
    let tree = parser.parse(source)!;
    expect(tree.rootNode.hasError).toBe(false);
    try {
      for (const replacement of ['𠀀́', '́𠀀', 'é']) {
        const edited = `${prefix}${replacement}${suffix}`;
        tree.edit(
          new Edit({
            startIndex: prefix.length,
            oldEndIndex: prefix.length + name.length,
            newEndIndex: prefix.length + replacement.length,
            startPosition: { row: 0, column: prefix.length },
            oldEndPosition: { row: 0, column: prefix.length + name.length },
            newEndPosition: { row: 0, column: prefix.length + replacement.length },
          })
        );
        const incremental = parser.parse(edited, tree)!;
        const fresh = parser.parse(edited)!;
        expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(incremental.rootNode.hasError).toBe(fresh.rootNode.hasError);
        expect(incremental.rootNode.descendantsOfType('Name').map((node) => node.text)).toContain('following');
        if (replacement !== '́𠀀') {
          expect(incremental.rootNode.hasError).toBe(false);
          expect(incremental.rootNode.descendantsOfType('Name').map((node) => node.text)).toContain(replacement);
        } else {
          expect(incremental.rootNode.hasError).toBe(true);
        }
        fresh.delete();
        tree.delete();
        tree = incremental;
        name = replacement;
      }
    } finally {
      tree.delete();
    }
  });
}
