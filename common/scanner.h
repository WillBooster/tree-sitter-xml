#pragma once

#include "tree_sitter/parser.h"

enum TokenType {
    PI_TARGET,
    PI_CONTENT,
    COMMENT,
    CHAR_REF,

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

// Every `chr` passed here is a non-zero ASCII literal, and `lexer->lookahead` is 0 at EOF and on NUL.
#define advance_if_eq(lexer, chr) \
    if ((lexer)->lookahead == (chr)) advance((lexer)); else return false

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline bool is_valid_xml_char(int32_t chr) {
    uint32_t u = (uint32_t)chr;
    if (u - 0x20u <= 0xD7FFu - 0x20u) return true;
    return u == 0xAu || u == 0x9u || u == 0xDu ||
           (u - 0xE000u <= 0xFFFDu - 0xE000u) ||
           (u - 0x10000u <= 0x10FFFFu - 0x10000u);
}

static int char_ref_digit(int32_t chr) {
    if (chr >= '0' && chr <= '9') return chr - '0';
    if (chr >= 'a' && chr <= 'f') return chr - 'a' + 10;
    if (chr >= 'A' && chr <= 'F') return chr - 'A' + 10;
    return -1;
}

static bool scan_char_ref(TSLexer *lexer) {
    advance_if_eq(lexer, '&');
    advance_if_eq(lexer, '#');
    unsigned base = 10;
    if (lexer->lookahead == 'x') {
        base = 16;
        advance(lexer);
    }
    uint32_t value = 0;
    bool has_digit = false;
    int digit;
    while ((digit = char_ref_digit(lexer->lookahead)) >= 0 && (unsigned)digit < base) {
        has_digit = true;
        value = value <= 0x10FFFF / base ? value * base + (unsigned)digit : 0x110000;
        advance(lexer);
    }
    if (!has_digit || !is_valid_xml_char((int32_t)value)) return false;
    advance_if_eq(lexer, ';');
    lexer->mark_end(lexer);
    lexer->result_symbol = CHAR_REF;
    return true;
}

static inline bool is_valid_non_ascii_name_start_char(int32_t chr) {
    return (chr >= 0xC0 && chr <= 0xD6) || (chr >= 0xD8 && chr <= 0xF6) ||
           (chr >= 0xF8 && chr <= 0x2FF) || (chr >= 0x370 && chr <= 0x37D) ||
           (chr >= 0x37F && chr <= 0x1FFF) || (chr >= 0x200C && chr <= 0x200D) ||
           (chr >= 0x2070 && chr <= 0x218F) || (chr >= 0x2C00 && chr <= 0x2FEF) ||
           (chr >= 0x3001 && chr <= 0xD7FF) || (chr >= 0xF900 && chr <= 0xFDCF) ||
           (chr >= 0xFDF0 && chr <= 0xFFFD) || (chr >= 0x10000 && chr <= 0xEFFFF);
}

static inline bool is_valid_name_start_char(int32_t chr) {
    if ((uint32_t)chr < 0x80u) {
        return ((uint32_t)(chr | 32) - (uint32_t)'a') < 26u || chr == '_' || chr == ':';
    }
    return is_valid_non_ascii_name_start_char(chr);
}

static inline bool is_valid_name_char(int32_t chr) {
    if ((uint32_t)chr < 0x80u) {
        return ((uint32_t)(chr | 32) - (uint32_t)'a') < 26u || ((uint32_t)chr - (uint32_t)'0') < 10u ||
               chr == '-' || chr == '_' || chr == ':' || chr == '.';
    }
    return is_valid_non_ascii_name_start_char(chr) || chr == 0xB7 ||
           (chr >= 0x300 && chr <= 0x36F) || (chr >= 0x203F && chr <= 0x2040);
}

#ifdef TS_XML
static inline bool ascii_equals(const char *buf, unsigned length, const char *literal, unsigned literal_len) {
    if (length != literal_len) return false;
    for (unsigned i = 0; i < literal_len; ++i) {
        if (buf[i] != literal[i]) return false;
    }
    return true;
}

#define ASCII_EQUALS(buf, len, literal) ascii_equals((buf), (len), (literal), sizeof(literal) - 1)
#endif

static bool scan_pi_target(TSLexer *lexer, const bool *valid_symbols) {
    if (!is_valid_name_start_char(lexer->lookahead)) {
        return false;
    }

    char ascii_target[sizeof("xml-stylesheet") + 1];
    unsigned length = 0;
    do {
        if (length < sizeof(ascii_target)) {
            ascii_target[length++] = lexer->lookahead < 0x80 ? (char)lexer->lookahead : 0x7F;
        }
        advance(lexer);
    } while (is_valid_name_char(lexer->lookahead));

    if (length == 3 &&
        (ascii_target[0] | 32) == 'x' &&
        (ascii_target[1] | 32) == 'm' &&
        (ascii_target[2] | 32) == 'l') {
        return false;
    }
#ifdef TS_XML
    if ((valid_symbols[XML_MODEL] && ASCII_EQUALS(ascii_target, length, "xml-model")) ||
        (valid_symbols[XML_STYLESHEET] && ASCII_EQUALS(ascii_target, length, "xml-stylesheet"))) {
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
    while (is_valid_xml_char(lexer->lookahead)) {
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
    advance_if_eq(lexer, '<');
    advance_if_eq(lexer, '!');
    advance_if_eq(lexer, '-');
    advance_if_eq(lexer, '-');

    while (is_valid_xml_char(lexer->lookahead)) {
        if (lexer->lookahead == '-') {
            advance(lexer);
            if (lexer->lookahead == '-') {
                advance(lexer);
                if (lexer->lookahead == '>') {
                    advance(lexer);
                    lexer->mark_end(lexer);
                    lexer->result_symbol = COMMENT;
                    return true;
                }
                return false;
            }
        } else {
            advance(lexer);
        }
    }

    return false;
}
