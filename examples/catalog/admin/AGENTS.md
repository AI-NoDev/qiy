# AI development guide

Read [OpenWiki quickstart](openwiki/quickstart.md) first, then follow the architecture and development links.

These documents describe the generated Qiy slice, not unrelated host application code. Inspect actual source and package scripts before making changes. Never read or expose live .env credentials. Qiy --sync rewrites manifest-owned files; keep custom behavior in unowned extensions or host adapters and review regeneration diffs.
