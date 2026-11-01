/**
 * @file Reusable constructs
 * @author ObserverOfTime
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/**
 * @param {"'" | ''} q
 * @see {@link https://www.w3.org/TR/xml/#NT-PubidChar}
 */
export const pubid_char = (q) =>
  new RegExp(`[ \\r\\na-zA-Z0-9\\-${q}()+,./:=?;!*#@$_%]*`);

/**
 * @param {GrammarSymbols<any>} $
 * @param {'"' | "'"} q
 */
export const att_value = ($, q) =>
  seq(
    q,
    optional(field(
      'content',
      alias(repeat1(choice(
        new RegExp(`[^<&${q}]`),
        $._Reference
      )), 'content')
    )),
    q
  );

/**
 * @param {GrammarSymbols<any>} $
 * @param {'"' | "'"} q
 */
export const entity_value = ($, q, allowParameterReferences = true) =>
  seq(
    q,
    optional(field(
      'content',
      alias(repeat1(choice(
        new RegExp(`[^%&${q}]`),
        ...(allowParameterReferences ? [$.PEReference] : []),
        $._Reference
      )), 'content')
    )),
    q
  );


/** @param {RuleOrLiteral[]} choices */
export const str = (...choices) =>
  choice(
    seq("'", ...choices, "'"),
    seq('"', ...choices, '"')
  );

/** @param {RuleOrLiteral[]} rules */
export const rseq = (...rules) => repeat(seq(...rules));

const nameStartChars = String.raw`:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}`;
const nameChars = String.raw`${nameStartChars}\-.0-9\u00B7\u0300-\u036F\u203F-\u2040`;

const O = optional;

/**
 * @param {boolean} allowParameterReferences
 * @returns {Record<string, ($: GrammarSymbols<any>) => RuleOrLiteral>}
 */
export const rules = (allowParameterReferences) => {
  /** @param {GrammarSymbols<any>} $ */
  const parameterReferences = ($) => allowParameterReferences ? [$.PEReference] : [];
  /**
   * @param {GrammarSymbols<any>} $
   * @param {RuleOrLiteral} first
   * @param {RuleOrLiteral[]} rest
   */
  const reference = ($, first, ...rest) => {
    const alternatives = [first, ...rest, ...parameterReferences($)];
    return alternatives.length > 1 ? choice(...alternatives) : first;
  };
  return {
    _markupdecl: $ => choice(
      $.elementdecl,
      $.AttlistDecl,
      $._EntityDecl,
      $.NotationDecl,
      $.PI,
      $.Comment
    ),

    _DeclSep: $ => choice($.PEReference, $._S),

    elementdecl: $ => seq(
      '<!',
      'ELEMENT',
      $._S,
      reference($, $.Name),
      $._S,
      $.contentspec,
      O($._S),
      '>'
    ),

    contentspec: $ => choice(
      'EMPTY',
      'ANY',
      $.Mixed,
      $.children,
      ...parameterReferences($)
    ),

    Mixed: $ => choice(
      seq(
        '(',
        O($._S),
        reference($, '#PCDATA'),
        rseq(
          O($._S),
          '|',
          O($._S),
          reference($, $.Name),
        ),
        O($._S),
        ...(allowParameterReferences ? [rseq($.PEReference, O($._S))] : []),
        ')',
        '*'
      ),
      prec(-1, seq(
        '(',
        O($._S),
        reference($, '#PCDATA'),
        O($._S),
        ...(allowParameterReferences ? [rseq($.PEReference, O($._S))] : []),
        ')'
      ))
    ),

    children: $ => prec(1, seq(
      $._choice,
      O(choice('?', '*', '+'))
    )),

    _cp: $ => prec.left(seq(
      reference($, $.Name, $._choice),
      O(choice('?', '*', '+'))
    )),

    _choice: $ => choice(...['|', ','].map(separator => seq(
      '(',
      O($._S),
      $._cp,
      rseq(
        O($._S),
        separator,
        O($._S),
        $._cp
      ),
      ...(allowParameterReferences ? [rseq(O($._S), $.PEReference)] : []),
      O($._S),
      ')'
    ))),

    AttlistDecl: $ => seq(
      '<!',
      'ATTLIST',
      $._S,
      reference($, $.Name),
      repeat(choice(
        $.AttDef,
        ...(allowParameterReferences ? [seq($._S, $.PEReference)] : [])
      )),
      O($._S),
      '>'
    ),

    AttDef: $ => {
      const concrete = seq($._AttType, $._S, $.DefaultDecl);
      return prec.right(seq(
        $._S,
        reference($, $.Name),
        $._S,
        allowParameterReferences
          ? choice(concrete, seq($.PEReference, O(seq($._S, $.DefaultDecl))))
          : concrete
      ));
    },

    _AttType: $ => choice(
      $.StringType,
      $.TokenizedType,
      $._EnumeratedType
    ),

    StringType: _ => 'CDATA',

    TokenizedType: _ => token(choice(
      'ID',
      'IDREF',
      'IDREFS',
      'ENTITY',
      'ENTITIES',
      'NMTOKEN',
      'NMTOKENS',
    )),

    _EnumeratedType: $ => choice(
      $.NotationType,
      $.Enumeration
    ),

    NotationType: $ => seq(
      'NOTATION',
      $._S,
      '(',
      O($._S),
      reference($, $.Name),
      rseq(
        O($._S),
        '|',
        O($._S),
        reference($, $.Name)
      ),
      O($._S),
      ')'
    ),

    Enumeration: $ => seq(
      '(',
      O($._S),
      $.Nmtoken,
      rseq(
        O($._S),
        '|',
        O($._S),
        $.Nmtoken
      ),
      O($._S),
      ')'
    ),

    DefaultDecl: $ => choice(
      '#REQUIRED',
      '#IMPLIED',
      seq(
        O(seq('#FIXED', $._S)),
        $.AttValue
      ),
      ...parameterReferences($)
    ),

    _EntityDecl: $ => choice(
      $.GEDecl,
      $.PEDecl
    ),

    GEDecl: $ => seq(
      '<!',
      'ENTITY',
      $._S,
      reference($, $.Name),
      $._S,
      choice(
        $.EntityValue,
        seq(
          $.ExternalID,
          O($.NDataDecl)
        )
      ),
      O($._S),
      '>'
    ),

    PEDecl: $ => seq(
      '<!',
      'ENTITY',
      $._S,
      '%',
      $._S,
      $.Name,
      $._S,
      choice(
        $.EntityValue,
        $.ExternalID
      ),
      O($._S),
      '>'
    ),

    EntityValue: $ => choice(
      entity_value($, '"', allowParameterReferences),
      entity_value($, "'", allowParameterReferences)
    ),

    NDataDecl: $ => seq($._S, 'NDATA', $._S, reference($, $.Name)),

    NotationDecl: $ => seq(
      '<!',
      'NOTATION',
      $._S,
      reference($, $.Name),
      $._S,
      choice($.ExternalID, $.PublicID),
      O($._S),
      '>'
    ),

    PEReference: $ => seq('%', $.Name, ';'),

    _S: _ => /[ \t\r\n]+/,

    Name: _ => new RegExp(`[${nameStartChars}][${nameChars}]*`, 'u'),

    Nmtoken: _ => new RegExp(`[${nameChars}]+`, 'u'),

    _Reference: $ => choice($.EntityRef, $.CharRef),

    EntityRef: $ => seq('&', $.Name, ';'),

    CharRef: _ => choice(
      seq('&#', /[0-9]+/, ';'),
      seq('&#x', /[0-9a-fA-F]+/, ';')
    ),

    AttValue: $ => choice(
      att_value($, '"'),
      att_value($, "'")
    ),

    ExternalID: $ => choice(
      seq('SYSTEM', $._S, $.SystemLiteral),
      seq('PUBLIC', $._S, $.PubidLiteral, $._S, $.SystemLiteral)
    ),

    PublicID: $ => prec.right(
      seq(reference($, 'PUBLIC'), $._S, $.PubidLiteral)
    ),

    SystemLiteral: $ => choice(
      seq('"', alias(/[^"]*/, $.URI), '"'),
      seq("'", alias(/[^']*/, $.URI), "'")
    ),

    PubidLiteral: _ => choice(
      seq('"', pubid_char("'"), '"'),
      seq("'", pubid_char(''), "'")
    ),

    _VersionInfo: $ => seq(
      $._S,
      'version',
      $._Eq,
      str($.VersionNum)
    ),

    VersionNum: _ => /1\.[0-9]+/,

    _EncodingDecl: $ => seq(
      $._S,
      'encoding',
      $._Eq,
      str($.EncName)
    ),

    EncName: _ => /[A-Za-z][A-Za-z0-9._\-]*/,

    PI: $ => seq(
      '<?',
      $.PITarget,
      O(seq($._S, $._pi_content)),
      '?>'
    ),

    _Eq: $ => seq(O($._S), '=', O($._S))
  };
};
