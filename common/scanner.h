#pragma once

#include "tree_sitter/parser.h"

#include <string.h>
#include <wctype.h>

enum TokenType {
    PI_TARGET,
    PI_CONTENT,
    COMMENT,

#ifdef TS_XML
    CHAR_DATA,
    XML_MODEL,
    XML_STYLESHEET,
    START_TAG_NAME,
    END_TAG_NAME,
    ERRONEOUS_END_NAME,
    SELF_CLOSING_TAG_DELIMITER,
#else
    IGNORE_CONTENT,
#endif
};

#define advance_if_eq(lexer, chr) \
    if (!lexer->eof(lexer) && (lexer)->lookahead == (chr)) advance((lexer)); else return false

#ifdef _WIN32
#undef max
#undef min
#endif

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline bool is_valid_name_start_char(int32_t chr) {
    return chr == ':' || chr == '_' || (chr >= 'A' && chr <= 'Z') ||
           (chr >= 'a' && chr <= 'z') || (chr >= 0xC0 && chr <= 0xD6) ||
           (chr >= 0xD8 && chr <= 0xF6) || (chr >= 0xF8 && chr <= 0x2FF) ||
           (chr >= 0x370 && chr <= 0x37D) || (chr >= 0x37F && chr <= 0x1FFF) ||
           (chr >= 0x200C && chr <= 0x200D) || (chr >= 0x2070 && chr <= 0x218F) ||
           (chr >= 0x2C00 && chr <= 0x2FEF) || (chr >= 0x3001 && chr <= 0xD7FF) ||
           (chr >= 0xF900 && chr <= 0xFDCF) || (chr >= 0xFDF0 && chr <= 0xFFFD) ||
           (chr >= 0x10000 && chr <= 0xEFFFF);
}

static inline bool is_valid_name_char(int32_t chr) {
    return is_valid_name_start_char(chr) || chr == '-' || chr == '.' ||
           (chr >= '0' && chr <= '9') || chr == 0xB7 ||
           (chr >= 0x300 && chr <= 0x36F) || (chr >= 0x203F && chr <= 0x2040);
}

static bool scan_pi_target(TSLexer *lexer, const bool *valid_symbols) {
    if (!is_valid_name_start_char(lexer->lookahead)) {
        return false;
    }

    char ascii_target[sizeof("xml-stylesheet") + 1] = {0};
    unsigned length = 0;
    do {
        if (length < sizeof(ascii_target) - 1) {
            ascii_target[length++] = lexer->lookahead < 0x80 ? (char)lexer->lookahead : 0x7F;
        }
        advance(lexer);
    } while (is_valid_name_char(lexer->lookahead));

    if (length == 3 && towlower(ascii_target[0]) == 'x' &&
        towlower(ascii_target[1]) == 'm' && towlower(ascii_target[2]) == 'l') {
        return false;
    }
#ifdef TS_XML
    if ((valid_symbols[XML_MODEL] && strcmp(ascii_target, "xml-model") == 0) ||
        (valid_symbols[XML_STYLESHEET] && strcmp(ascii_target, "xml-stylesheet") == 0)) {
        return false;
    }
#else
    (void)valid_symbols;
#endif

    lexer->mark_end(lexer);
    lexer->result_symbol = PI_TARGET;
    return true;
}

static bool scan_pi_content(TSLexer *lexer) {
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '?') {
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == '>') {
                lexer->result_symbol = PI_CONTENT;
                return true;
            }
        } else {
            advance(lexer);
        }
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = PI_CONTENT;
    return true;
}

static bool scan_comment(TSLexer *lexer) {
    advance_if_eq(lexer, '-');
    advance_if_eq(lexer, '-');

    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '-') {
            advance(lexer);
            if (lexer->lookahead == '-') {
                advance(lexer);
                break;
            }
        } else {
            advance(lexer);
        }
    }

    if (lexer->lookahead == '>') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = COMMENT;
        return true;
    }

    return false;
}
