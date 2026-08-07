# frontend

A single-page demo of the pour pool. Generates notes, builds a **Groth16 proof in the
browser**, and sends the result to the contract on Sepolia. No backend — keys are created
in the tab and never leave it.

Plan and rationale: [`implementation.md`](implementation.md).
Protocol: [`../docs/protocol.md`](../docs/protocol.md).

## Run it

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

```bash
npm test               # note derivation + a real proof, in node
npm run build          # typecheck + production build to dist/
npm run preview        # serve dist/ locally
```

`npm test` is the one to run before trusting anything: it proves a witness built by the
browser's own `note.ts` and checks the result verifies, so a broken derivation shows up in
about a second instead of as a failed transaction.

## What talks to what

| | |
|---|---|
| Pool | `0x9097c70e0aCE543FE9cE07393b3865864cEF6C5f` on Sepolia |
| Subgraph | `https://api.studio.thegraph.com/query/97495/zcash-pour-subgraph/version/latest` |
| Prover artefacts | `public/circuit/` — wasm, zkey, verification key, manifest |

All four live in [`src/config.ts`](src/config.ts) except the artefacts, which are files.

`public/circuit/` is **committed**, like the generated verifier `.sol` is. `circuits/build/`
is gitignored, so without committing them Vercel would build a site with no prover.

## When the circuit changes

Any edit to `ZcashPour.circom` — or any re-run of `npm run setup`, even with an unchanged
circuit — produces a new zkey. That changes `delta` in the verifier, which invalidates
every existing proof **and** the deployed pool.

```bash
cd ../circuits
npm run all ZcashPour 16        # compile + trusted setup + export verifier
npm run prove ZcashPour         # regenerate the reference proof
npm run check                   # JS Poseidon still matches the circuit?

cd ../contracts
npm test                        # verifier and fixtures agree
npm run deploy:sepolia          # REQUIRED: the old pool rejects new proofs

cd ../frontend
npm run sync-circuit            # copy wasm + zkey, rewrite manifest.json
npm test                        # the port still matches the new circuit
```

Then update `POOL_ADDRESS` in `src/config.ts` to the address the redeploy printed.

`sync-circuit` compares the zkey it copied against the hash in the exported verifier's
banner and tells you which you have:

```
verifier was exported from zkey e7404d8ca8a392fc...
MATCH -- proofs will verify
```

If it says `MISMATCH`, the verifier was exported from a different ceremony than the zkey
you are shipping — re-export and redeploy before doing anything else. The app also reads
`manifest.json` at boot and shows a red banner on mismatch, because the alternative is a
transaction failing with `invalid proof` and no clue why.

**`sync-circuit` is deliberately not part of `npm run build`.** It reads `../circuits/build/`,
which does not exist on Vercel. Run it locally and commit the result.

## When the contract changes

Redeploying is the common case — new address, same shape:

1. `POOL_ADDRESS` in [`src/config.ts`](src/config.ts).
2. `subgraph.yaml` in [`../contracts/zcash-pour-subgraph/`](../contracts/zcash-pour-subgraph) —
   both `address` and `startBlock`, then redeploy the subgraph. A subgraph pointed at an
   old address indexes nothing and fails silently.
3. `SUBGRAPH_URL` if the subgraph slug or version changed.

If the **ABI** changed — a new argument, a renamed event — also update `POOL_ABI` in
`src/config.ts`. It is a hand-written minimal ABI covering only the functions this app
calls, not a copy of the artefact, so it does not update itself.

If **events** changed, the subgraph mappings and schema need updating too; that is
`../contracts/zcash-pour-subgraph/`, not this directory.

## Layout

```
src/
├── main.ts       shell + hash router
├── config.ts     address, ABI, subgraph URL, circuit paths
├── note.ts       field, Poseidon, note derivation   (port of circuits/lib)
├── note.test.ts  pins that port to the circuit's committed vector
├── prover.ts     snarkjs fullProve + Solidity calldata
├── manifest.ts   stale-artefact check (kept apart so it does not pull in snarkjs)
├── chain.ts      wallet connect, contract, error unwrapping
├── ui.ts         DOM helpers, wei/ETH formatting
└── screens/      one file per tab
```

`note.ts` duplicates `circuits/lib/`. That is deliberate — the Node version is CommonJS
and takes randomness from `node:crypto`, so bundling it would mean polyfilling more than
the file is long. `note.test.ts` asserts the two agree on the circuit's own vector, so
drift fails a test rather than a transaction.

## Bundle

The crypto is loaded on demand, not at first paint:

```
index.js    268 kB   (100 kB gzip)   shell, ethers, screens
note.js   2,966 kB (1,403 kB gzip)   circomlibjs -> ffjavascript, on first note
```

`snarkjs` is a further dynamic import inside `prover.ts`, so it only arrives when someone
actually pours. Most of the weight is `ffjavascript`, shared by both.

## Deploying to Vercel

Import the repo and set **Root Directory** to `frontend`. Framework preset Vite; build
command `npm run build`; output `dist`. No environment variables — every address is in
`config.ts` and the site is fully static.

## Not built on purpose

WalletConnect, note storage, mobile-first layout, and visual polish. The point of this
page is that the proof is real and the verification happens on chain; anything that does
not serve that was left out. Each screen also prints its arguments for the block
explorer's Write Contract tab, so the whole thing is usable with no wallet at all.
