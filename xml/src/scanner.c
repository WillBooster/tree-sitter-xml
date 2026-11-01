#define TS_XML
#include "../../common/scanner.h"
#include "tree_sitter/array.h"

#include <assert.h>
#include <string.h>

typedef Array(char) String;

typedef struct {
    String name;
    uint32_t parent;
} TagFrame;

typedef struct {
    Array(TagFrame) frames;
    uint32_t current;
} Scanner;

static inline bool string_eq(const String *a, const String *b) {
    if (a->size != b->size) {
        return false;
    }
    return memcmp(a->contents, b->contents, a->size) == 0;
}

static void append_code_point(String *string, int32_t code_point);

static String scan_tag_name(TSLexer *lexer) {
    String tag_name = array_new();
    if (!is_valid_name_start_char(lexer->lookahead)) {
        return tag_name;
    }
    append_code_point(&tag_name, lexer->lookahead);
    advance(lexer);
    while (is_valid_name_char(lexer->lookahead)) {
        append_code_point(&tag_name, lexer->lookahead);
        advance(lexer);
    }
    return tag_name;
}

static void append_code_point(String *string, int32_t code_point) {
    if (code_point <= 0x7F) {
        array_push(string, (char)code_point);
    } else if (code_point <= 0x7FF) {
        array_push(string, (char)(0xC0 | (code_point >> 6)));
        array_push(string, (char)(0x80 | (code_point & 0x3F)));
    } else if (code_point <= 0xFFFF) {
        array_push(string, (char)(0xE0 | (code_point >> 12)));
        array_push(string, (char)(0x80 | ((code_point >> 6) & 0x3F)));
        array_push(string, (char)(0x80 | (code_point & 0x3F)));
    } else {
        array_push(string, (char)(0xF0 | (code_point >> 18)));
        array_push(string, (char)(0x80 | ((code_point >> 12) & 0x3F)));
        array_push(string, (char)(0x80 | ((code_point >> 6) & 0x3F)));
        array_push(string, (char)(0x80 | (code_point & 0x3F)));
    }
}

static bool scan_start_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_tag_name(lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    lexer->result_symbol = START_TAG_NAME;
    TagFrame frame = {tag_name, scanner->current};
    array_push(&scanner->frames, frame);
    scanner->current = scanner->frames.size;
    return true;
}

static bool scan_end_tag_name(Scanner *scanner, TSLexer *lexer) {
    String tag_name = scan_tag_name(lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    const TagFrame *frame = scanner->current > 0 ? array_get(&scanner->frames, scanner->current - 1) : NULL;
    if (frame && string_eq(&frame->name, &tag_name)) {
        scanner->current = frame->parent;
        lexer->result_symbol = END_TAG_NAME;
    } else {
        lexer->result_symbol = ERRONEOUS_END_NAME;
    }
    array_delete(&tag_name);
    return lexer->result_symbol == END_TAG_NAME;
}

static bool scan_self_closing_tag_delimiter(Scanner *scanner, TSLexer *lexer) {
    advance(lexer);
    advance_if_eq(lexer, '>');
    if (scanner->current > 0) {
        scanner->current = array_get(&scanner->frames, scanner->current - 1)->parent;
        lexer->result_symbol = SELF_CLOSING_TAG_DELIMITER;
    }
    return true;
}

static inline bool in_error_recovery(const bool *valid_symbols) {
    return valid_symbols[PI_TARGET] && valid_symbols[PI_CONTENT] && valid_symbols[COMMENT] && valid_symbols[CHAR_REF] &&
           valid_symbols[CHAR_DATA];
}

static inline bool in_char_data(TSLexer *lexer) {
    return !lexer->eof(lexer) && is_valid_xml_char(lexer->lookahead) && lexer->lookahead != '<' && lexer->lookahead != '&';
}

static bool scan_char_data(TSLexer *lexer) {
    bool advanced_once = false;

    while (in_char_data(lexer)) {
        if (lexer->lookahead == ']') {
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == ']') {
                do {
                    advance(lexer);
                } while (lexer->lookahead == ']');
                if (lexer->lookahead == '>') {
                    lexer->result_symbol = CHAR_DATA;
                    return advanced_once;
                }
            }
        } else {
            advance(lexer);
        }
        advanced_once = true;
    }

    lexer->mark_end(lexer);
    lexer->result_symbol = CHAR_DATA;
    return advanced_once;
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

void *tree_sitter_xml_external_scanner_create() {
    Scanner *scanner = (Scanner *)ts_calloc(1, sizeof(Scanner));
    if (scanner == NULL) abort();
    return scanner;
}

void tree_sitter_xml_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    for (uint32_t i = 0; i < scanner->frames.size; ++i) {
        array_delete(&array_get(&scanner->frames, i)->name);
    }
    array_delete(&scanner->frames);
    ts_free(scanner);
}

// The runtime creates a scanner for each full parse. Immutable frames retain names for every parse branch;
// snapshots only need a frame ID, so nesting depth and name length cannot truncate serialized state.
unsigned tree_sitter_xml_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
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
