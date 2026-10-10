# Qiy Language Support for JetBrains IDEs

This IntelliJ Platform plugin recognizes `.qiy` files and provides syntax highlighting for Qiy keywords, types, annotations, strings, comments and punctuation.

## Build a ZIP plugin

Install Gradle 8+ and a JDK compatible with IntelliJ Platform 2024.3, then run:

```powershell
cd editors/jetbrains-qiy
gradle buildPlugin
```

The plugin ZIP is written to `build/distributions/`. Install it with **Settings → Plugins → ⚙ → Install Plugin from Disk**.

## Marketplace publication

Create the Marketplace plugin entry, add `JETBRAINS_MARKETPLACE_TOKEN` as the GitHub Actions secret, then push a tag such as `v0.1.0`.

The plugin intentionally stays lightweight: it edits/highlights text; the Qiy CLI remains the source of parsing and generation truth.
