import { Language, Parser } from '@willbooster/web-tree-sitter';
import { afterAll, expect, test } from 'vitest';

await Parser.init();
const dtd = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-dtd.wasm`));
const xml = new Parser().setLanguage(await Language.load(`${import.meta.dirname}/../../tree-sitter-xml.wasm`));
afterAll(() => {
  dtd.delete();
  xml.delete();
});

const ignoredContents = [
  'not a declaration < > & %missing; "quoted',
  '<![nested raw < > & ]]> after',
  '<![INCLUDE[<!ELEMENT hidden EMPTY>]]>',
  'a]b]]c]]]d',
  ']]]',
  'before <![one <![two]]> after]]> end',
];

test('ignored DTD sections preserve opaque text and nested delimiter ranges', () => {
  for (const content of ignoredContents) {
    const section = `<![IGNORE[${content}]]>`;
    const source = `${section}<!ELEMENT root EMPTY>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, content).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const node = tree.rootNode.descendantsOfType('conditionalSect')[0]!;
      expect(node.text).toBe(section);
      expect(node.startIndex).toBe(0);
      expect(node.endIndex).toBe(section.length);
      const ignored = node.descendantsOfType('Ignore')[0]!;
      expect(ignored.text).toBe(content);
      expect(ignored.startIndex).toBe('<![IGNORE['.length);
      expect(ignored.endIndex).toBe('<![IGNORE['.length + content.length);
      expect(node.descendantsOfType('PEReference')).toHaveLength(0);
      expect(node.descendantsOfType('elementdecl')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('elementdecl').map((n) => n.text)).toEqual(['<!ELEMENT root EMPTY>']);
    } finally {
      tree.delete();
    }
  }
});

test('empty and spaced ignored sections terminate at their matching delimiter', () => {
  for (const section of ['<![IGNORE[]]>', '<![ IGNORE [ ]]>']) {
    const source = `${section}<!--after--><?after value?><!ELEMENT root EMPTY>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      expect(tree.rootNode.namedChildren.map((node) => node.type)).toEqual([
        'conditionalSect',
        'Comment',
        'PI',
        'elementdecl',
      ]);
      const comment = tree.rootNode.descendantsOfType('Comment')[0]!;
      expect(comment.text).toBe('<!--after-->');
      expect(comment.startIndex).toBe(section.length);
      expect(tree.rootNode.descendantsOfType('PITarget')[0]?.text).toBe('after');
    } finally {
      tree.delete();
    }
  }
});

test('literal INCLUDE sections still parse declarations and reject raw ignored text', () => {
  for (const [content, error] of [
    ['<!ELEMENT root EMPTY>', false],
    ['<![IGNORE[raw text]]>', false],
    ['raw < > & text', true],
  ] as const) {
    const source = `<![INCLUDE[${content}]]>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(error);
      expect(tree.rootNode.endIndex).toBe(source.length);
      if (content.startsWith('<!ELEMENT'))
        expect(tree.rootNode.descendantsOfType('elementdecl')[0]?.text).toBe(content);
    } finally {
      tree.delete();
    }
  }
});

test('parameter-selected conditional sections accept either included declarations or ignored text', () => {
  for (const [mode, content] of [
    ['IGNORE', 'raw & %unexpanded;'],
    ['INCLUDE', '<!ELEMENT root EMPTY>'],
  ] as const) {
    const source = `<!ENTITY % mode "${mode}"><![%mode;[${content}]]>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const section = tree.rootNode.descendantsOfType('conditionalSect')[0]!;
      const reference = section.descendantsOfType('PEReference')[0]!;
      expect(section.descendantsOfType(mode === 'IGNORE' ? 'ConditionalContent' : 'elementdecl')[0]?.text).toBe(
        content
      );
      expect(reference.text).toBe('%mode;');
      expect(reference.startIndex).toBe(source.indexOf('%mode;'));
      expect(reference.endIndex).toBe(source.indexOf('%mode;') + '%mode;'.length);
    } finally {
      tree.delete();
    }
  }
});

test('unterminated ignored nesting and forbidden XML conditional sections report errors', () => {
  for (const source of ['<![IGNORE[raw', '<![IGNORE[<![nested]]>', '<![IGNORE[raw]]', '<![IGNORE[raw]]> trailing']) {
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  }
  const source = '<!DOCTYPE root [<![IGNORE[raw]]>]><root/>';
  const tree = xml.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.endIndex).toBe(source.length);
  } finally {
    tree.delete();
  }
});

test('ignored text, closing-bracket runs, and unterminated nesting have linear input reads', () => {
  for (const form of ['text', 'brackets', 'nested'] as const) {
    const reads: number[] = [];
    for (const count of [200, 2000]) {
      const content =
        form === 'text'
          ? 'opaque < > & text '.repeat(count)
          : form === 'brackets'
            ? ']'.repeat(count)
            : '<![nested'.repeat(count);
      const source = `<![IGNORE[${content}${form === 'nested' ? '' : ']]>'}`;
      let total = 0;
      const tree = dtd.parse((index) => {
        total++;
        return source.slice(index, index + 64);
      })!;
      try {
        expect(tree.rootNode.hasError).toBe(form === 'nested');
        expect(tree.rootNode.endIndex).toBe(source.length);
        if (form !== 'nested') expect(tree.rootNode.descendantsOfType('Ignore')[0]?.text).toBe(content);
      } finally {
        tree.delete();
      }
      reads.push(total);
    }
    expect(reads[1]! / reads[0]!, form).toBeLessThan(18);
  }
});

test('parameter-selected declarations retain delimiter text inside literals and comments', () => {
  for (const body of [
    '<!ENTITY e "]]><![["><!ELEMENT root EMPTY>',
    '<!-- <![ --><!ELEMENT root EMPTY>',
    '<!ATTLIST root value CDATA "]]>">',
    '<!-- ]]> --><!ELEMENT root EMPTY>',
  ]) {
    const source = `<!ENTITY % mode "INCLUDE"><![%mode;[${body}]]>`;
    const tree = dtd.parse(source)!;
    try {
      expect(tree.rootNode.hasError, body).toBe(false);
      expect(tree.rootNode.endIndex).toBe(source.length);
      const section = tree.rootNode.descendantsOfType('conditionalSect')[0]!;
      expect(section.text).toBe(`<![%mode;[${body}]]>`);
      expect(
        section.namedChildren
          .slice(1)
          .map((node) => node.text)
          .join('')
      ).toBe(body);
      expect(section.startIndex).toBe(source.indexOf('<![%mode;['));
      expect(section.endIndex).toBe(source.length);
    } finally {
      tree.delete();
    }
  }
});
