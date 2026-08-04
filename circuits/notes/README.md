# notes/

Where `tools/new-note.js --name <name>` puts your notes.

**Every file in here is a private key.** A note holds `sk` in the clear, and `sk` is the
only thing standing between a coin and whoever else gets hold of it. `../.gitignore`
excludes `notes/*.json` — leave it that way.

Lose a note file and the ETH is stranded in the pool: `burn` re-derives the commitment
from `sk`, `rho`, `r`, and `value`, and there is no recovery path without them.

```bash
node tools/new-note.js --value 100 --name alice
```
