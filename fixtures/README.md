# Fixtures

Checked-in sample material for exercising the app by hand. None of it is referenced by code or
tests; a test that needs a vault builds one in a temporary directory instead.

- `mock-vault/` — the original sample vault: notes, UID boundaries and a `.crashweaver/` card store.
- `mock-vault_sample/` — a copy of it, to open in the app and write to so the original image stays
  untouched.

The copy is a working snapshot, not a byte-identical twin: it was taken before the last few
crashpads, the embedding cache and the newest request log were added to `mock-vault/`, and its
`.crashweaver/index.json` differs too. That is fine for manual exercise — if an exact copy matters,
copy `mock-vault/` yourself.

To exercise the app, open `mock-vault_sample/` as the vault. Opening `mock-vault/` means the sample
notes, cards and crashpads change and stop matching the original image.

Both directories carry the layout the app expects: markdown notes at the root and in subdirectories,
and a hidden `.crashweaver/` directory holding the vault index, card store, crashpads and Weaver
request logs.
