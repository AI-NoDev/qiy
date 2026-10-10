# Qiy Language Support for VS Code

Adds `.qiy` recognition, TextMate syntax highlighting, `//` comments, bracket matching and quote/bracket auto-closing.

## Local development

```powershell
cd editors/vscode-qiy
bunx @vscode/vsce package
```

Install the resulting VSIX through **Extensions: Install from VSIX...**.

## Marketplace publication

1. Create and verify the `qiy-language` publisher in Visual Studio Marketplace, or replace `publisher` in `package.json` with the verified publisher ID.
2. Create a Marketplace token with publish scope and store it as GitHub secret `VSCE_PAT`.
3. Push a tag such as `v0.1.0`; the repository workflow packages and publishes the VSIX.

The extension only provides editing assistance. Parsing, validation and code generation remain the Qiy CLI responsibilities.
