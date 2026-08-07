# Frontend — implementation plan

Not approved yet. Read, argue, then I build.

## What this is for

A recruiter opens one link and, in two minutes, sees that the author understands
zero-knowledge proofs. It is **not** a portfolio piece for frontend work, and it should
not pretend to be. That single goal decides every trade-off below: anything that makes
the ZK part more visible is worth doing, anything that only makes the UI prettier is not.

The thing worth showing off is this: **the browser generates a real Groth16 proof, and a
contract on Sepolia verifies it.** No backend, no trusted server, no faking it. That is
the demo. Everything else is plumbing around it.

## What is already live

| | |
|---|---|
| Pool | [`0x9097c70e0aCE543FE9cE07393b3865864cEF6C5f`](https://sepolia.etherscan.io/address/0x9097c70e0aCE543FE9cE07393b3865864cEF6C5f) on Sepolia |
| Subgraph | `https://api.studio.thegraph.com/query/97495/zcash-pour-subgraph/version/latest` |
| Indexed | 12 commitments, 2 nullifiers, 10 mints, 1 pour, 1 burn, 0.009 ETH |

Both verified working. The subgraph has no indexing errors and its burn entities carry
decoded `value` and `recipient`.

## Stack

| Choice | Why |
|---|---|
| Vite + vanilla TypeScript | No React. Four screens, no shared state worth a framework. Less code for a reviewer to wade through before reaching the interesting part. |
| ethers v6 | Already the repo's ethers. `BrowserProvider` over `window.ethereum`. |
| snarkjs (browser build) | `groth16.fullProve` runs the same prover the CLI uses. |
| circomlibjs | Poseidon, same parameters as circuit and contract. |
| plain `fetch` for GraphQL | The queries are four fixed strings. Apollo would be more setup than the app. |
| Hand-written CSS, ~150 lines | Dark, monospace, terminal-ish. Deliberately plain. |

**No WalletConnect.** It needs a project ID, a cloud account, and a pile of config for
zero benefit here — a recruiter opening this has MetaMask or nothing. Injected provider
only, with a manual fallback (below) that works with no wallet at all.

## Wallet strategy: both, because the fallback is nearly free

Every action produces a set of arguments. So each screen renders:

1. **"Send with wallet"** — if `window.ethereum` exists and is on Sepolia.
2. **"Copy args for Etherscan"** — always. Prints the arguments in the exact order the
   Write Contract tab wants, with a deep link to `#writeContract`.

The fallback costs one function and one button, and it means the page still demonstrates
everything if a reviewer has no wallet, no Sepolia ETH, or does not want to connect one
to a stranger's site. It also doubles as the "I understand what this transaction actually
is" affordance.

## Screens

### 1. Mint — create a note and shield ETH

- Amount input (ETH, converted to wei).
- Generates `sk`, `rho`, `r` locally; derives `pk`, `snProduce`, `cm`, `snConsume`.
- Shows the note, a **Download note JSON** button, and a copy button.
- Blocking warning before the tx: *this file is the coin; lose it and the ETH is
  unrecoverable*. Download must happen before the mint button enables.
- Then `mint(_value, _cm, _r, _snProduce)` with `msg.value == _value`.

### 2. Pour — the actual demo

- Load a note (paste JSON or drop a file).
- Fetch commitments from the subgraph, assemble a `cm_list` of 10 that includes this
  note's `cm`.
- Default: **split to yourself.** Generates two fresh notes you own, so no second party
  and no key exchange is needed. Optional advanced fields for someone else's `pk`.
- Amount split, defaulting to half/half, validated as `v1 + v2 == v`.
- **Prove in the browser**, with visible stages: build witness → prove → verify locally.
  Show elapsed ms; it is the number that makes the point.
- Then `pour(pA, pB, pC, pubSignals)`.
- Emit the two new notes for download — same "this is the coin" warning.

This screen carries the demo. It gets the most explanatory copy: what is public
(commitments, nullifier), what is hidden (which note, the amounts), and why the ten
commitments exist.

### 3. Burn — unshield

- Load a note, choose a recipient address.
- `burn(_value, _r, _rho, _sk, _recipient)`.
- States plainly that burn is **transparent**: value, `r`, `rho`, and `sk` all become
  public, and publishing `sk` links every note made for that key.

### 4. Explore — read the subgraph

- Pool totals.
- Commitments and nullifiers, paged.
- "My activity": paste or connect an address, get its mints / pours / burns.

## Layout

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── public/
│   └── circuit/            ZcashPour.wasm (2.30 MB), ZcashPour_final.zkey (2.12 MB),
│                           verification_key.json, manifest.json
├── scripts/
│   └── sync-circuit.mjs    copies artefacts from ../circuits/build + writes manifest
└── src/
    ├── main.ts             router: four tabs, no framework
    ├── config.ts           address, ABI, subgraph URL, chain id
    ├── note.ts             field, Poseidon, derivations   <-- see drift note
    ├── prover.ts           snarkjs fullProve + calldata formatting
    ├── chain.ts            ethers: connect, send, Etherscan fallback
    ├── subgraph.ts         the four queries
    ├── ui.ts               tiny DOM helpers
    └── style.css
```

## Two hazards worth designing around

**1. Circuit artefacts must match the deployed verifier.** The zkey encodes `delta`; the
deployed pool encodes the matching one. Re-running `npm run setup` invalidates both the
proof *and* the deployment — this has already bitten this project twice.

Mitigation: `scripts/sync-circuit.mjs` copies the wasm and zkey out of
`../circuits/build/ZcashPour/` and writes `manifest.json` with the zkey sha256, the
contract address, and a build timestamp. The app fetches the manifest at boot and shows a
warning banner if the zkey hash does not match what it was built against. A stale prover
otherwise fails as `"invalid proof"` on chain, which is a miserable thing to debug from a
browser.

**2. `note.ts` duplicates `circuits/lib/`.** The Node version uses `crypto.randomBytes`
and CommonJS; the browser needs `crypto.getRandomValues` and ESM. Bundling the Node one
means polyfills for a 40-line file, which is worse.

Mitigation: `note.ts` ships with a vector test asserting it reproduces the same `cm` and
`snConsume` as `circuits/inputs/ZcashPour.json` and the committed proof — the same check
`npm run check` does on the Node side. If the two ever drift, that test fails.

## Security posture

- **Fully static.** No backend, so there is nowhere for a secret to be sent. Worth saying
  out loud on the page.
- Secrets exist only in memory and in files the user downloads. No `localStorage` — a key
  that survives the tab is a key that outlives the user's attention.
- Every screen that reveals `sk` says so.
- The site is a demo on a testnet with a **single-contributor trusted setup**. A banner
  says this, permanently. Overstating it would be the one genuinely dishonest thing this
  page could do.

## Things I am deliberately not building

- WalletConnect / multi-wallet
- Note storage, encryption, or any kind of wallet UI
- Mobile-first anything; it will not break on a phone but is designed for a laptop
- Pretty. It will be clean and legible and that is all.

## Risks

| Risk | Handling |
|---|---|
| 4.4 MB of prover assets | Loaded lazily, only when the Pour tab is opened. Progress indicator. Fine on any desktop connection. |
| Proving time in-browser | ~4,600 constraints is small; expect a few seconds. Measured and displayed rather than hidden. |
| Subgraph lag after a mint | A just-minted commitment may not be indexed when Pour opens. Refresh button plus an explicit "indexed up to block N" line. |
| `cm_list` needs 10 commitments | Twelve exist. If the pool ever has fewer, the Pour tab explains why it is disabled rather than failing at prove time. |
| User loses a note | Download gated before minting; repeated warnings. Cannot do better without custody. |

## Order of work

Each step is verifiable before the next.

1. Scaffold + `sync-circuit.mjs` + config. Verify the manifest and asset fetch.
2. `note.ts` + its vector test. **Must pass before anything else is built on it.**
3. Mint screen, wallet connect, Etherscan fallback — end-to-end mint on Sepolia.
4. Explore screen. Cheap, and it proves the subgraph wiring independently of proving.
5. `prover.ts` — prove in the browser, verify locally with the vkey, compare against a
   known-good CLI proof before ever sending a transaction.
6. Pour screen, wired to a real `pour()`.
7. Burn screen.
8. Explanatory copy, the "how it works" panel, README, deploy to GitHub Pages.

Step 5 is the risky one and comes before the UI around it, so a failure there costs
nothing already built.

## Decisions

1. **Deploy target: Vercel.** Static build, two-click import from the repo, root set to
   `frontend/`.
2. **Pour defaults to splitting to yourself.** Two fresh notes you own, so the whole thing
   demos in one browser with no second party. The screen states that paying someone
   else's `pk` is what a pour is actually for, and leaves the field available.
3. **Explore stays, trimmed.** It is the only place the subgraph is visible, and having
   built and deployed one is a separate skill worth showing. One screen: pool totals, a
   combined activity feed, and the commitment / nullifier lists. No paging, no arbitrary
   address lookup -- "my activity" uses the connected wallet.
