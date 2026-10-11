package dev.qiy.intellij

import com.intellij.lexer.Lexer
import com.intellij.lexer.LexerBase
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterBase
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.tree.IElementType

private class QiyTokenType(debugName: String) : IElementType(debugName, QiyLanguage)

private object QiyTokens {
    val COMMENT = QiyTokenType("COMMENT")
    val STRING = QiyTokenType("STRING")
    val KEYWORD = QiyTokenType("KEYWORD")
    val TYPE = QiyTokenType("TYPE")
    val NUMBER = QiyTokenType("NUMBER")
    val ANNOTATION = QiyTokenType("ANNOTATION")
    val PUNCTUATION = QiyTokenType("PUNCTUATION")
    val IDENTIFIER = QiyTokenType("IDENTIFIER")
}

private class QiyLexer : LexerBase() {
    private var buffer: CharSequence = ""
    private var endOffset = 0
    private var tokenStart = 0
    private var tokenEnd = 0
    private var tokenType: IElementType? = null

    override fun start(buffer: CharSequence, startOffset: Int, endOffset: Int, initialState: Int) {
        this.buffer = buffer
        this.endOffset = endOffset
        tokenStart = startOffset
        tokenEnd = startOffset
        locateToken()
    }

    override fun getState() = 0
    override fun getTokenType(): IElementType? = tokenType
    override fun getTokenStart() = tokenStart
    override fun getTokenEnd() = tokenEnd
    override fun getBufferSequence() = buffer
    override fun getBufferEnd() = endOffset

    override fun advance() {
        tokenStart = tokenEnd
        locateToken()
    }

    private fun locateToken() {
        if (tokenStart >= endOffset) {
            tokenType = null
            return
        }
        val current = buffer[tokenStart]
        if (current.isWhitespace()) {
            tokenEnd = tokenStart + 1
            while (tokenEnd < endOffset && buffer[tokenEnd].isWhitespace()) tokenEnd += 1
            tokenType = null
            return
        }
        if (current == '#' || (current == '/' && tokenStart + 1 < endOffset && buffer[tokenStart + 1] == '/')) {
            tokenEnd = tokenStart + if (current == '#') 1 else 2
            while (tokenEnd < endOffset && buffer[tokenEnd] != '\n') tokenEnd += 1
            tokenType = QiyTokens.COMMENT
            return
        }
        if (current == '\'' || current == '"') {
            val quote = current
            tokenEnd = tokenStart + 1
            while (tokenEnd < endOffset) {
                if (buffer[tokenEnd] == '\\') tokenEnd += 2
                else if (buffer[tokenEnd++] == quote) break
            }
            tokenType = QiyTokens.STRING
            return
        }
        if (current == '@') {
            tokenEnd = consumeIdentifier(tokenStart + 1)
            tokenType = QiyTokens.ANNOTATION
            return
        }
        if (current.isDigit()) {
            tokenEnd = tokenStart + 1
            while (tokenEnd < endOffset && buffer[tokenEnd].isDigit()) tokenEnd += 1
            tokenType = QiyTokens.NUMBER
            return
        }
        if (current.isLetter() || current == '_') {
            tokenEnd = consumeIdentifier(tokenStart + 1)
            val word = buffer.subSequence(tokenStart, tokenEnd).toString()
            tokenType = when {
                word in KEYWORDS -> QiyTokens.KEYWORD
                word in TYPES -> QiyTokens.TYPE
                else -> QiyTokens.IDENTIFIER
            }
            return
        }
        tokenEnd = tokenStart + 1
        tokenType = QiyTokens.PUNCTUATION
    }

    private fun consumeIdentifier(start: Int): Int {
        var index = start
        while (index < endOffset && (buffer[index].isLetterOrDigit() || buffer[index] == '_' || buffer[index] == '-')) index += 1
        return index
    }

    private companion object {
        val KEYWORDS = setOf("qiy", "v0", "application", "include", "database", "extension", "api", "client", "cors", "origin", "elysia", "bearer", "serverTiming", "graphqlAdapter", "adapter", "cron", "job", "pattern", "task", "jwt", "secretEnv", "static", "assets", "prefix", "html", "drizzle", "storage", "provider", "auth", "user", "subjectField", "roleField", "usernameField", "passwordField", "workflow", "enum", "value", "label", "color", "icon", "entity", "table", "field", "index", "relation", "scope", "claim", "menu", "group", "resource", "dashboard", "metric", "workspace", "name", "aliases", "packages", "ui", "library", "theme", "themes", "colorMode", "allowThemeSwitch", "allowColorModeSwitch", "light", "dark", "system", "mode", "integration", "apiBase", "csrfCookie", "csrfHeader", "env", "variable", "secret", "development", "production", "example", "generate", "messages", "default", "locale", "t", "dataflow", "idempotency", "required", "audit", "allow", "roles", "input", "context", "by", "step", "require", "update", "result", "return", "action", "navigate", "placement", "page")
        val TYPES = setOf("UUID", "Text", "Integer", "Decimal", "Money", "DateTime", "File", "Vector", "postgresql", "mysql", "sqlite", "pgvector", "postgis", "btree", "hnsw", "ivfflat", "true", "false", "local", "s3", "oidc", "oauth2", "sso", "rest", "graphql", "native", "yoga", "apollo", "one", "many", "restrict", "cascade", "setNull", "count", "distribution", "trend")
    }
}

private object QiySyntaxHighlighter : SyntaxHighlighterBase() {
    private val COMMENT = TextAttributesKey.createTextAttributesKey("QIY_COMMENT", DefaultLanguageHighlighterColors.LINE_COMMENT)
    private val STRING = TextAttributesKey.createTextAttributesKey("QIY_STRING", DefaultLanguageHighlighterColors.STRING)
    private val KEYWORD = TextAttributesKey.createTextAttributesKey("QIY_KEYWORD", DefaultLanguageHighlighterColors.KEYWORD)
    private val TYPE = TextAttributesKey.createTextAttributesKey("QIY_TYPE", DefaultLanguageHighlighterColors.KEYWORD)
    private val NUMBER = TextAttributesKey.createTextAttributesKey("QIY_NUMBER", DefaultLanguageHighlighterColors.NUMBER)
    private val ANNOTATION = TextAttributesKey.createTextAttributesKey("QIY_ANNOTATION", DefaultLanguageHighlighterColors.METADATA)
    private val PUNCTUATION = TextAttributesKey.createTextAttributesKey("QIY_PUNCTUATION", DefaultLanguageHighlighterColors.BRACES)

    override fun getHighlightingLexer(): Lexer = QiyLexer()
    override fun getTokenHighlights(tokenType: IElementType) = when (tokenType) {
        QiyTokens.COMMENT -> pack(COMMENT)
        QiyTokens.STRING -> pack(STRING)
        QiyTokens.KEYWORD -> pack(KEYWORD)
        QiyTokens.TYPE -> pack(TYPE)
        QiyTokens.NUMBER -> pack(NUMBER)
        QiyTokens.ANNOTATION -> pack(ANNOTATION)
        QiyTokens.PUNCTUATION -> pack(PUNCTUATION)
        else -> EMPTY
    }
}

class QiySyntaxHighlighterFactory : SyntaxHighlighterFactory() {
    override fun getSyntaxHighlighter(project: Project?, virtualFile: VirtualFile?): SyntaxHighlighter = QiySyntaxHighlighter
}
