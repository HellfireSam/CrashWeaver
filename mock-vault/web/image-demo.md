# Image Linking Demo

This note demonstrates how to embed a local image inside a CrashWeaver card's `raw_content`.
The vault-root-relative path is used — the same way Obsidian resolves attachments.

%%CW_CARD_START uid:CW-IMG-001%%

### Embedding a Local Image

When writing a card's content, reference images with a path **relative to the vault root**.
A leading slash is treated as the vault root.

```
![A friendly cat](/cat.jpg)
```

Rendered result (the cat.jpg placed at the vault root):

![A friendly cat](/cat.jpg)

**Why vault-root-relative paths?**
CrashWeaver rewrites relative `src` attributes in the markdown preview to
`file:///vault-root/path` so Electron can load local assets without a web server.
Images stored in sub-folders are referenced the same way:

```
![Diagram](/architecture/diagram.png)
```

%%CW_CARD_END uid:CW-IMG-001%%
