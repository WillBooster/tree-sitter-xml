#pragma once

#include "tree_sitter/parser.h"

enum TokenType {
    PI_TARGET,
    PI_CONTENT,
    COMMENT,

#ifdef TS_XML
    CHAR_DATA,
    CDATA,
    XML_MODEL,
    XML_STYLESHEET,
    START_TAG_NAME,
    END_TAG_NAME,
    ERRONEOUS_END_NAME,
    SELF_CLOSING_TAG_DELIMITER,
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

static inline bool check_word(TSLexer *lexer, const char *const word, unsigned length) {
    for (unsigned j = 0; j < length; ++j) {
        advance_if_eq(lexer, word[j]);
    }
    return true;
}

static bool scan_pi_target(TSLexer *lexer, const bool *valid_symbols) {
    bool advanced_once = false, found_x_first = false;
#ifndef TS_XML
    (void)valid_symbols;
#endif

    if (is_valid_name_start_char(lexer->lookahead)) {
        if (lexer->lookahead == 'x' || lexer->lookahead == 'X') {
            found_x_first = true;
            lexer->mark_end(lexer);
        }
        advanced_once = true;
        advance(lexer);
    }

    if (advanced_once) {
        while (is_valid_name_char(lexer->lookahead)) {
            if (found_x_first && (lexer->lookahead == 'm' || lexer->lookahead == 'M')) {
                advance(lexer);
                if (lexer->lookahead == 'l' || lexer->lookahead == 'L') {
                    advance(lexer);
                    if (is_valid_name_char(lexer->lookahead)) {
#ifdef TS_XML
                        found_x_first = false;
                        bool last_char_hyphen = lexer->lookahead == '-';
                        advance(lexer);
                        if (last_char_hyphen) {
                            if (valid_symbols[XML_MODEL] && check_word(lexer, "model", 5))
                                return false;
                            if (valid_symbols[XML_STYLESHEET] && check_word(lexer, "stylesheet", 10))
                                return false;
                        }
#endif
                    } else {
                        return false;
                    }
                }
            }

            found_x_first = false;
            advance(lexer);
        }

        lexer->mark_end(lexer);
        lexer->result_symbol = PI_TARGET;
        return true;
    }

    return false;
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
    return false;
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
