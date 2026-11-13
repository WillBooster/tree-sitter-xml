#define TS_XML
#include "../../common/scanner.h"
#include "tree_sitter/array.h"

#include <assert.h>
#include <string.h>

typedef struct {
    uint32_t offset;
    uint32_t length;
    uint32_t parent;
} TagFrame;

typedef struct {
    Array(TagFrame) frames;
    Array(char) names;
    uint32_t current;
} Scanner;

static inline uint32_t encode_utf8(int32_t code_point, char out[4]) {
    uint32_t cp = (uint32_t)code_point;
    if (cp <= 0x7Fu) {
        out[0] = (char)cp;
        return 1;
    }
    if (cp <= 0x7FFu) {
        out[0] = (char)(0xC0u | (cp >> 6));
        out[1] = (char)(0x80u | (cp & 0x3Fu));
        return 2;
    }
    if (cp <= 0xFFFFu) {
        out[0] = (char)(0xE0u | (cp >> 12));
        out[1] = (char)(0x80u | ((cp >> 6) & 0x3Fu));
        out[2] = (char)(0x80u | (cp & 0x3Fu));
        return 3;
    }
    out[0] = (char)(0xF0u | (cp >> 18));
    out[1] = (char)(0x80u | ((cp >> 12) & 0x3Fu));
    out[2] = (char)(0x80u | ((cp >> 6) & 0x3Fu));
    out[3] = (char)(0x80u | (cp & 0x3Fu));
    return 4;
}

static inline void append_code_point(Scanner *scanner, int32_t code_point) {
    if ((uint32_t)code_point <= 0x7Fu) {
        if (scanner->names.size == UINT32_MAX) abort();
        array_push(&scanner->names, (char)code_point);
        return;
    }
    char encoded[4];
    uint32_t len = encode_utf8(code_point, encoded);
    if (UINT32_MAX - scanner->names.size < len) abort();
    for (uint32_t i = 0; i < len; ++i) {
        array_push(&scanner->names, encoded[i]);
    }
}

static bool scan_start_tag_name(Scanner *scanner, TSLexer *lexer) {
    if (!is_valid_name_start_char(lexer->lookahead)) {
        return false;
    }
    if (scanner->frames.capacity == 0) {
        array_reserve(&scanner->frames, 64);
        array_reserve(&scanner->names, 256);
    }

    uint32_t offset = scanner->names.size;
    append_code_point(scanner, lexer->lookahead);
    advance(lexer);
    while (is_valid_name_char(lexer->lookahead)) {
        append_code_point(scanner, lexer->lookahead);
        advance(lexer);
    }

    if (scanner->frames.size == UINT32_MAX) abort();
    TagFrame frame = {offset, scanner->names.size - offset, scanner->current};
    array_push(&scanner->frames, frame);
    scanner->current = scanner->frames.size;
    lexer->result_symbol = START_TAG_NAME;
    return true;
}

static inline bool match_code_point(
    const char *expected,
    uint32_t expected_len,
    uint32_t *matched,
    int32_t code_point
) {
    if ((uint32_t)code_point <= 0x7Fu) {
        if (*matched >= expected_len || expected[*matched] != (char)code_point) {
            return false;
        }
        (*matched)++;
        return true;
    }
    char encoded[4];
    uint32_t len = encode_utf8(code_point, encoded);
    if (expected_len - *matched < len) {
        return false;
    }
    for (uint32_t i = 0; i < len; ++i) {
        if (expected[*matched + i] != encoded[i]) {
            return false;
        }
    }
    *matched += len;
    return true;
}

static bool scan_end_tag_name(Scanner *scanner, TSLexer *lexer) {
    if (scanner->current == 0 || !is_valid_name_start_char(lexer->lookahead)) {
        return false;
    }

    const TagFrame *frame = array_get(&scanner->frames, scanner->current - 1);
    const char *expected = scanner->names.contents + frame->offset;
    uint32_t expected_len = frame->length;
    uint32_t matched = 0;

    if (!match_code_point(expected, expected_len, &matched, lexer->lookahead)) {
        return false;
    }
    advance(lexer);
    while (is_valid_name_char(lexer->lookahead)) {
        if (!match_code_point(expected, expected_len, &matched, lexer->lookahead)) {
            return false;
        }
        advance(lexer);
    }
    if (matched != expected_len) {
        return false;
    }

    scanner->current = frame->parent;
    lexer->result_symbol = END_TAG_NAME;
    return true;
}

static bool scan_self_closing_tag_delimiter(Scanner *scanner, TSLexer *lexer) {
    if (scanner->current == 0) {
        return false;
    }
    advance(lexer);
    advance_if_eq(lexer, '>');
    scanner->current = array_get(&scanner->frames, scanner->current - 1)->parent;
    lexer->result_symbol = SELF_CLOSING_TAG_DELIMITER;
    return true;
}

static inline bool in_error_recovery(const bool *valid_symbols) {
    return valid_symbols[PI_TARGET] && valid_symbols[PI_CONTENT] && valid_symbols[COMMENT] && valid_symbols[CHAR_REF] &&
           valid_symbols[CHAR_DATA];
}

static inline bool in_char_data(TSLexer *lexer) {
    int32_t chr = lexer->lookahead;
    return chr != '<' && chr != '&' && is_valid_xml_char(chr);
}

static bool scan_char_data(TSLexer *lexer) {
    bool advanced_once = false;
    bool marked_end = false;

    while (in_char_data(lexer)) {
        if (lexer->lookahead != ']') {
            advance(lexer);
            advanced_once = true;
            continue;
        }
        marked_end = true;
        lexer->mark_end(lexer);
        unsigned brackets = 0;
        do {
            advance(lexer);
            brackets++;
        } while (lexer->lookahead == ']');
        if (brackets >= 2 && lexer->lookahead == '>') {
            lexer->result_symbol = CHAR_DATA;
            return advanced_once;
        }
        advanced_once = true;
    }

    if (!advanced_once) {
        return false;
    }
    if (marked_end) {
        lexer->mark_end(lexer);
    }
    lexer->result_symbol = CHAR_DATA;
    return true;
}

bool tree_sitter_xml_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    if (in_error_recovery(valid_symbols)) {
        return false;
    }

    if (valid_symbols[PI_TARGET]) {
        return scan_pi_target(lexer, valid_symbols);
    }

    if (valid_symbols[PI_CONTENT]) {
        return scan_pi_content(lexer);
    }

    if (valid_symbols[CHAR_DATA] && scan_char_data(lexer)) {
        return true;
    }

    switch (lexer->lookahead) {
        case '&':
            return valid_symbols[CHAR_REF] && scan_char_ref(lexer);
        case '<':
            return valid_symbols[COMMENT] && scan_comment(lexer);
        case '/':
            if (valid_symbols[SELF_CLOSING_TAG_DELIMITER]) {
                return scan_self_closing_tag_delimiter(scanner, lexer);
            }
            break;
        default:
            if (valid_symbols[START_TAG_NAME]) {
                return scan_start_tag_name(scanner, lexer);
            }
            if (valid_symbols[END_TAG_NAME]) {
                return scan_end_tag_name(scanner, lexer);
            }
    }

    return false;
}

void *tree_sitter_xml_external_scanner_create(void) {
    Scanner *scanner = (Scanner *)ts_calloc(1, sizeof(Scanner));
    if (scanner == NULL) abort();
    return scanner;
}

void tree_sitter_xml_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    array_delete(&scanner->frames);
    array_delete(&scanner->names);
    ts_free(scanner);
}

// The runtime creates a scanner for each parse. Append-only frames and name bytes remain valid across
// parse branches; snapshots only need the active frame ID (omitted at root depth 0), so nesting depth and
// name length cannot truncate serialized state.
unsigned tree_sitter_xml_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    if (scanner->current == 0) {
        return 0;
    }
    memcpy(buffer, &scanner->current, sizeof(scanner->current));
    return sizeof(scanner->current);
}

void tree_sitter_xml_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->current = 0;
    if (length == sizeof(scanner->current)) {
        memcpy(&scanner->current, buffer, sizeof(scanner->current));
        assert(scanner->current <= scanner->frames.size);
    }
}
