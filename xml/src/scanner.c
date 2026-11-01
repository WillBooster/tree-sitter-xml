#define TS_XML
#include "../../common/scanner.h"
#include "tree_sitter/array.h"

#include <string.h>

typedef Array(char) String;

typedef Array(String) Vector;

static inline bool string_eq(String *a, String *b) {
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

static bool scan_start_tag_name(Vector *tags, TSLexer *lexer) {
    String tag_name = scan_tag_name(lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    lexer->result_symbol = START_TAG_NAME;
    array_push(tags, tag_name);
    return true;
}

static bool scan_end_tag_name(Vector *tags, TSLexer *lexer) {
    String tag_name = scan_tag_name(lexer);
    if (tag_name.size == 0) {
        array_delete(&tag_name);
        return false;
    }

    if (tags->size > 0 && string_eq(array_back(tags), &tag_name)) {
        String last_tag = array_pop(tags);
        array_delete(&last_tag);
        lexer->result_symbol = END_TAG_NAME;
    } else {
        lexer->result_symbol = ERRONEOUS_END_NAME;
    }
    array_delete(&tag_name);
    return lexer->result_symbol == END_TAG_NAME;
}

static bool scan_self_closing_tag_delimiter(Vector *tags, TSLexer *lexer) {
    advance(lexer);
    advance_if_eq(lexer, '>');
    if (tags->size > 0) {
        String last_tag = array_pop(tags);
        array_delete(&last_tag);
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
    Vector *tags = (Vector *)payload;

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
            lexer->mark_end(lexer);
            advance(lexer);
            if (lexer->lookahead == '!') {
                advance(lexer);
                return scan_comment(lexer);
            }
            break;
        case '/':
            if (valid_symbols[SELF_CLOSING_TAG_DELIMITER]) {
                return scan_self_closing_tag_delimiter(tags, lexer);
            }
            break;
        default:
            if (valid_symbols[START_TAG_NAME]) {
                return scan_start_tag_name(tags, lexer);
            }
            if (valid_symbols[END_TAG_NAME]) {
                return scan_end_tag_name(tags, lexer);
            }
    }

    return false;
}

void *tree_sitter_xml_external_scanner_create() {
    Vector *tags = (Vector *)ts_calloc(1, sizeof(Vector));
    if (tags == NULL) abort();
    array_init(tags);
    return tags;
}

void tree_sitter_xml_external_scanner_destroy(void *payload) {
    Vector *tags = (Vector *)payload;
    for (uint32_t i = 0; i < tags->size; ++i) {
        array_delete(array_get(tags, i));
    }
    array_delete(tags);
    ts_free(tags);
}

unsigned tree_sitter_xml_external_scanner_serialize(void *payload, char *buffer) {
    Vector *tags = (Vector *)payload;
    uint32_t tag_count = tags->size > UINT16_MAX ? UINT16_MAX : tags->size;
    uint32_t serialized_tag_count = 0, size = sizeof tag_count;

    memcpy(&buffer[size], &tag_count, size);
    size += sizeof tag_count;

    for (; serialized_tag_count < tag_count; ++serialized_tag_count) {
        String *tag = array_get(tags, serialized_tag_count);
        uint32_t name_length = tag->size;
        uint32_t length_size = name_length < UINT8_MAX ? 1 : 1 + sizeof(uint16_t);
        if (name_length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE ||
            size + length_size + name_length > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) {
            break;
        }
        buffer[size++] = (char)(name_length < UINT8_MAX ? name_length : UINT8_MAX);
        if (name_length >= UINT8_MAX) {
            uint16_t extended_length = name_length;
            memcpy(&buffer[size], &extended_length, sizeof extended_length);
            size += sizeof extended_length;
        }
        if (name_length > 0) {
            memcpy(&buffer[size], tag->contents, name_length);
        }
        size += name_length;
    }

    memcpy(&buffer[0], &serialized_tag_count, sizeof serialized_tag_count);
    return size;
}

void tree_sitter_xml_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Vector *tags = (Vector *)payload;

    if (length == 0) {
        for (unsigned i = 0; i < tags->size; ++i) {
            array_delete(array_get(tags, i));
        }
        array_clear(tags);
        return;
    }

    uint32_t size = 0, tag_count = 0, serialized_tag_count = 0;
    memcpy(&serialized_tag_count, &buffer[size], sizeof serialized_tag_count);
    size += sizeof serialized_tag_count;
    memcpy(&tag_count, &buffer[size], sizeof tag_count);
    size += sizeof tag_count;

    while (tags->size > tag_count) {
        String tag = array_pop(tags);
        array_delete(&tag);
    }
    while (tags->size < tag_count) {
        array_push(tags, ((String)array_new()));
    }
    for (uint32_t i = 0; i < tag_count; ++i) {
        String *tag = array_get(tags, i);
        tag->size = 0;
        if (i < serialized_tag_count) {
            uint32_t name_length = (uint8_t)buffer[size++];
            if (name_length == UINT8_MAX) {
                uint16_t extended_length;
                memcpy(&extended_length, &buffer[size], sizeof extended_length);
                size += sizeof extended_length;
                name_length = extended_length;
            }
            array_reserve(tag, name_length);
            if (name_length > 0) {
                memcpy(tag->contents, &buffer[size], name_length);
                size += name_length;
            }
            tag->size = name_length;
        } else {
            array_delete(tag);
        }
    }
}
