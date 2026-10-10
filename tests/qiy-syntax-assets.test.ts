import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const grammarPath = "editors/syntax/qiy.tmLanguage.json";
const vscodeGrammarPath = "editors/vscode-qiy/syntaxes/qiy.tmLanguage.json";

test("ships a valid shared TextMate grammar for docs and VS Code", () => {
  const grammar = JSON.parse(readFileSync(grammarPath, "utf8")) as { scopeName: string; fileTypes: string[]; repository: Record<string, unknown> };
  const vscodeGrammar = JSON.parse(readFileSync(vscodeGrammarPath, "utf8"));
  expect(grammar.scopeName).toBe("source.qiy");
  expect(grammar.fileTypes).toContain("qiy");
  expect(grammar.repository).toHaveProperty("keywords");
  expect(vscodeGrammar).toEqual(grammar);
});

test("declares distributable VS Code and JetBrains language plugins", () => {
  const vscode = JSON.parse(readFileSync("editors/vscode-qiy/package.json", "utf8")) as { contributes: { languages: Array<{ extensions: string[] }>; grammars: Array<{ scopeName: string }> } };
  const pluginXml = readFileSync("editors/jetbrains-qiy/src/main/resources/META-INF/plugin.xml", "utf8");
  expect(vscode.contributes.languages[0]?.extensions).toContain(".qiy");
  expect(vscode.contributes.grammars[0]?.scopeName).toBe("source.qiy");
  expect(pluginXml).toContain("lang.syntaxHighlighterFactory");
  expect(pluginXml).toContain('extensions="qiy"');
});
