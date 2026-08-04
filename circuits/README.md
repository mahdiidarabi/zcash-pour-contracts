# circuits

Circom circuits, the Groth16 build pipeline, and the note tooling users run to build
data for the pool. Spec: [`../docs/protocol.md`](../docs/protocol.md).

## Requirements

- [circom](https://docs.circom.io/getting-started/installation/) 2.x on `PATH`
- `npm install`

## Layout

| Path | |
|---|---|
| `circuits/<name>.circom` | source — must declare `component main` |
| `inputs/<name>.json` | witness input |
| `build/<name>/` | generated — r1cs, wasm, zkey, proof. Disposable. |
| `ptau/` | powers-of-tau cache, shared by all circuits. Expensive. |
| `scripts/` | the build pipeline (bash) |
| `lib/` | pure functions — field, Poseidon, note derivation |
| `tools/` | the commands you run |
| `notes/` | your notes. **Secret**, gitignored. |

`lib/` holds the math and does no I/O. `tools/` handles flags, files, and printing.
Keeping those apart is what stops either half from growing complicated.

## Build pipeline

```bash
npm run compile <circuit>              # circom -> r1cs / wasm / sym
npm run setup <circuit> [power]        # powers of tau + groth16 setup (default power 12)
npm run prove <circuit> [input]        # witness -> proof -> verify
npm run export-verifier <circuit>      # -> ../contracts/contracts/verifiers/
npm run all <circuit> [power]          # compile + setup + export-verifier
npm run clean                          # rm -rf build (keeps the ptau cache)
```

Circuit name defaults to `Multiplier`. Env vars work too, and compose:
`CIRCUIT=ZcashPour POWER=16 npm run all`.

`ptau/` is phase 1: universal, circuit-independent, reusable forever. `build/<name>/*.zkey`
is phase 2: circuit-specific, and invalid the moment you edit the circuit. `prove` refuses
to run against a stale zkey rather than failing with a confusing `Invalid proof`.

`power` caps the circuit at `2^power` constraints. 12 is fine for toys; `ZcashPour` has
4,612 constraints so it needs at least 13, and the build uses 16.

> **`npm run setup` produces a new zkey every time, even from an identical circuit** —
> the phase-2 contribution draws fresh entropy. That changes `delta` in the exported
> verifier and invalidates every proof you have already generated, including the
> committed `build/ZcashPour/proof.json` the contract tests read. Re-run `npm run prove`
> after any setup, and redeploy the pool — a deployed contract embeds the old `delta`.
> Only run `setup` when the r1cs actually changed.

## Note tooling

```bash
npm run check                            # JS Poseidon vs the circuit
node tools/new-note.js   --value <wei> [--name <name>] [--allow-big]
node tools/pour-input.js --note <f> --cm-list <f> --v1 <wei> --pk1 <field> \
                         --v2 <wei> --pk2 <field> --out <f>
node tools/calldata.js   [--circuit <name>]
node tools/burn-args.js  --note <f> --recipient <address>
```

### Making a note

```bash
node tools/new-note.js --value 100 --name alice     # -> notes/alice.json
node tools/new-note.js --value 100 > alice.json     # or take stdout
```

stdout is JSON so it pipes; everything human goes to stderr. `notes/<name>.json` looks
like this — the secrets, the four derived values, and the `mint()` arguments already in
the contract's order:

```json
{
  "sk":        "4143533250535631703676827235469432381822940616646215478182392373405907179928",
  "rho":       "8761403729809959682050525441395835927162199916123811473669343417407390036817",
  "r":         "14587976748587113418548269608768141216707536684161723950361650435122376982486",
  "value":     "100",
  "pk":        "5811979940743038170814473465129576009713487524917352424028685784552501736424",
  "snProduce": "5203406516258278279535956555501703213217122635247899790765191545745634625169",
  "cm":        "8090532853644093474269103835644491729255054034959170045264247729206942694676",
  "snConsume": "15732441362581086667631868209823344755230355545883448383789129233605315367872",
  "mint": {
    "_value":     "100",
    "_cm":        "8090532853644093474269103835644491729255054034959170045264247729206942694676",
    "_r":         "14587976748587113418548269608768141216707536684161723950361650435122376982486",
    "_snProduce": "5203406516258278279535956555501703213217122635247899790765191545745634625169"
  }
}
```

Derivation, all Poseidon (`../docs/protocol.md` §3):

```
pk        = Poseidon(sk)                  who can spend it
snProduce = Poseidon(rho, pk)             the note's serial
cm        = Poseidon(r, snProduce, v)     what goes on chain
snConsume = Poseidon(snProduce, sk)       the nullifier, published on spend
```

**`sk` is the coin.** Anyone holding `notes/alice.json` can burn it; losing the file
strands the ETH permanently, because `burn` re-derives the commitment from the secrets
and there is no recovery path. `notes/*.json` is gitignored — keep it that way.

### Spending it

```js
const note = require("./notes/alice.json");

await pool.mint(note.mint._value, note.mint._cm, note.mint._r, note.mint._snProduce,
                { value: note.mint._value });

await pool.burn(note.value, note.r, note.rho, note.sk, recipient);
```

`msg.value` must equal `_value` exactly, and `_value` must be positive.

### Two things that decide whether you can pour later

**Values must stay under 2¹²⁸.** `pour` splits `v` into `v1 + v2` and range-checks both
with `Num2Bits(128)`, the bound that keeps the sum from wrapping the field. It is far
above any real amount, but `mint` accepts any `uint256`, so the tooling checks it.
`new-note.js` refuses anything at or above the ceiling rather than letting you discover
it twenty seconds into proving. `--allow-big` overrides it for notes you only ever intend
to mint and burn.

The bound lives in one place, `lib/limits.js`. If you change the `Num2Bits` width in
`pour_circuit()`, change it there too — nothing else hardcodes it.

**The pool needs ten commitments before any pour is possible.** `pour` takes
`cm_list[10]` and the contract requires every entry to already exist on chain, so one
minted note is not enough. Mint ten:

```bash
for name in alice bob carol dave erin frank grace heidi ivan judy; do
  node tools/new-note.js --value 100 --name "$name"
done
```

Nothing checks that `cm_list` entries are distinct, so you *can* pad with the same
commitment ten times. It works, and it identifies your spent note exactly — fine for a
first end-to-end test, useless for privacy. See `../docs/protocol.md` §10.

### Pouring

Spend one note into two. You need ten commitments that already exist in the pool, one of
which is the note you are spending:

```bash
node tools/pour-input.js \
  --note notes/alice.json \
  --cm-list cmlist.json \
  --v1 40 --pk1 <recipient pk> \
  --v2 60 --pk2 <recipient pk> \
  --out inputs/pour1.json > outputs.json

npm run prove ZcashPour inputs/pour1.json
node tools/calldata.js > calldata.json
```

`--out` gets the circom input, which must contain exactly the circuit's input signals.
**stdout gets the two output notes** — whoever you paid cannot spend theirs without the
`r` and `rho` chosen here, and the chain only ever sees the commitment. Hand those over
out of band; combined with their own `sk` they form a spendable note.

`v1 + v2` must equal the spent note's value exactly, and the tool checks it, along with
the cm_list length, whether your note is actually in the list, and whether the note file
is self-consistent.

Then `pour(pA, pB, pC, pubSignals)` with the contents of `calldata.json`. `calldata.js`
exists mainly to get one detail right: snarkjs writes the inner pairs of `pi_b` in the
opposite order to the Solidity verifier, and getting it wrong just returns false.

### Burning

```bash
node tools/burn-args.js --note notes/alice.json --recipient 0xabc...
```

Prints the five `burn()` arguments. Everything it prints ends up in public calldata,
including `sk` — which links this note to every other note made for the same key.

## Verifying the tooling

```bash
npm run check
```

Re-derives the coin described by `inputs/ZcashPour.json` and asserts it reproduces the
`cm` and `sn_consume` in the committed proof. If a `circomlibjs` bump ever changes
Poseidon, this fails in a second instead of surfacing as an unprovable witness. It also
catches a `public.json` left over from a stale zkey.

The contract side is covered by `../contracts/test/ZcashPourNotes.test.ts`, which builds
notes with this same library and mints and burns them against a real deployment.

## Notes

The exported verifier is a build artifact but is committed, so the repo compiles without
re-running the ceremony. Never edit it by hand.

The trusted setup here has a single contributor — fine for testnet, **not** fine for real
value. Whoever holds the toxic waste can forge proofs.
