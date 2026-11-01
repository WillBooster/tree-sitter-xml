#include "../../common/scanner.h"

#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable : 4100)
#elif defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-parameter"
#endif

static inline bool in_error_recovery(const bool *valid_symbols) {
    return valid_symbols[PI_TARGET] && valid_symbols[PI_CONTENT] && valid_symbols[COMMENT] && valid_symbols[CHAR_REF] &&
           valid_symbols[IGNORE_CONTENT];
}

static bool scan_ignore_bracket(TSLexer *lexer);
static void scan_ignore_delimiter(TSLexer *lexer, unsigned *depth);

static bool scan_ignore_content(TSLexer *lexer) {
    unsigned depth = 0;
    bool has_content = false;
    while (!lexer->eof(lexer) && is_valid_xml_char(lexer->lookahead)) {
        if (lexer->lookahead == ']' && depth == 0) {
            if (has_content) break;
            return scan_ignore_bracket(lexer);
        }
        scan_ignore_delimiter(lexer, &depth);
        has_content = true;
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = IGNORE_CONTENT;
    return has_content;
}

static bool scan_ignore_bracket(TSLexer *lexer) {
    advance(lexer);
    lexer->mark_end(lexer);
    if (lexer->lookahead == ']') {
        advance(lexer);
        if (lexer->lookahead == '>') return false;
    }
    lexer->result_symbol = IGNORE_CONTENT;
    return true;
}

static void scan_ignore_delimiter(TSLexer *lexer, unsigned *depth) {
        switch (lexer->lookahead) {
            case '<':
                advance(lexer);
                if (lexer->lookahead != '!') break;
                advance(lexer);
                if (lexer->lookahead != '[') break;
                advance(lexer);
                (*depth)++;
                break;
            case ']': {
                unsigned brackets = 0;
                do {
                    advance(lexer);
                    brackets++;
                } while (lexer->lookahead == ']');
                if (brackets < 2 || lexer->lookahead != '>') break;
                advance(lexer);
                (*depth)--;
                break;
            }
            default:
                advance(lexer);
        }
}

bool tree_sitter_dtd_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    if (in_error_recovery(valid_symbols))
        return false;

    if (valid_symbols[IGNORE_CONTENT])
        return scan_ignore_content(lexer);

    if (valid_symbols[CHAR_REF] && lexer->lookahead == '&')
        return scan_char_ref(lexer);

    if (valid_symbols[PI_TARGET])
        return scan_pi_target(lexer, valid_symbols);

    if (valid_symbols[PI_CONTENT])
        return scan_pi_content(lexer);

    if (valid_symbols[COMMENT]) {
        return scan_comment(lexer);
    }

    return false;
}

void *tree_sitter_dtd_external_scanner_create() { return NULL; }

void tree_sitter_dtd_external_scanner_destroy(void *payload) {}

unsigned tree_sitter_dtd_external_scanner_serialize(void *payload, char *buffer) { return 0; }

void tree_sitter_dtd_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

#ifdef _MSC_VER
#pragma warning(pop)
#elif defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic pop
#endif
