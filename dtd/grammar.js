/**
 * @file Tree-sitter grammar definition for DTD
 * @author ObserverOfTime
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

import * as c from '../common/common.mjs';

const O = optional;

export default grammar({
  name: 'dtd',

  externals: $ => [
    $.PITarget,
    $._pi_content,
    $.Comment,
    $._ignore_content,
  ],

  extras: _ => [],

  supertypes: $ => [
    $._markupdecl,
    $._AttType,
    $._EnumeratedType,
    $._EntityDecl,
    $._Reference,
  ],

  conflicts: $ => [
    [$.AttlistDecl, $.AttDef],
    [$._parameterInclude, $._parameterIgnore]
  ],

  word: $ => $.Name,

  rules: {
    extSubset: $ => seq(
      O($.TextDecl),
      repeat($._extSubsetDecl)
    ),

    TextDecl: $ => seq(
      '<?',
      'xml',
      O($._VersionInfo),
      $._EncodingDecl,
      O($._S),
      '?>'
    ),

    _extSubsetDecl: $ => choice(
      $._markupdecl,
      $.conditionalSect,
      $._DeclSep
    ),

    conditionalSect: $ => seq(
      '<![',
      O($._S),
      choice(
        seq(choice('INCLUDE', $._parameterInclude), O($._S), '[', repeat($._extSubsetDecl)),
        seq('IGNORE', O($._S), '[', O($.Ignore)),
        seq($._parameterIgnore, O($._S), '[', O(alias($.Ignore, $.ConditionalContent)))
      ),
      ']]>'
    ),

    _parameterInclude: $ => prec.dynamic(1, $.PEReference),

    _parameterIgnore: $ => $.PEReference,

    Ignore: $ => repeat1($._ignore_content),

    ...c.rules(true)
  }
});
