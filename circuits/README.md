<!-- circom circuits/Multiplier.circom --r1cs --wasm --sym --c -o ./build  

node ./build/Multiplier_js/generate_witness.js ./build/Multiplier_js/Multiplier.wasm ./build/input.json ./build/witness.wtns


snarkjs powersoftau new bn128 12 ptau/pot12_0000.ptau -v 

snarkjs powersoftau contribute ptau/pot12_0000.ptau ptau/pot12_0001.ptau --name="First Contribution" -v

snarkjs powersoftau prepare phase2 ptau/pot12_0001.ptau ptau/pot12_final.ptau -v 

snarkjs groth16 setup ./build/Multiplier.r1cs ./ptau/pot12_final.ptau ./ptau/Multiplier_0000.zkey


snarkjs zkey contribute ./ptau/Multiplier_0000.zkey ./ptau/Multiplier_0001.zkey --name="1st Contributor Name" -v

snarkjs zkey export verificationkey ./ptau/Multiplier_0001.zkey ./ptau/verification_key.json


snarkjs groth16 prove ./ptau/Multiplier_0001.zkey ./build/witness.wtns proof.json public.json


snarkjs groth16 verify ./ptau/verification_key.json public.json proof.json

snarkjs zkey export solidityverifier ./ptau/Multiplier_0001.zkey verifier.sol -->


# circuits

  Circom circuits and the Groth16 build pipeline. See [`../docs/protocol.md`](../docs/protocol.md)
  for the pour spec and the implementation plan.

  ## Requirements
  
  - [circom](https://docs.circom.io/getting-started/installation/) 2.x on `PATH`
  - `npm install`

  ## Commands
  
  ```bash
  npm run compile <circuit>              # circom -> r1cs / wasm / sym
  npm run setup <circuit> [power]        # powers of tau + groth16 setup (default power 12)
  npm run prove <circuit> [input]        # witness -> proof -> verify
  npm run export-verifier <circuit>      # -> ../contracts/contracts/verifiers/
  npm run all <circuit> [power]          # compile + setup + export-verifier
  npm run clean                          # rm -rf build (keeps the ptau cache)
  ```

  Circuit name defaults to `Multiplier`. Env vars work too, and compose:
  `CIRCUIT=pour POWER=16 npm run all`.

  ```bash
  npm run all Multiplier 12
  npm run prove Multiplier
  ```

  ## Layout

  | Path | |
  |---|---|
  | `circuits/<name>.circom` | source — must declare `component main` |
  | `circuits/lib/` | templates to `include`; not build targets on their own |
  | `inputs/<name>.json` | witness input |
  | `build/<name>/` | generated — r1cs, wasm, zkey, proof. Disposable. |
  | `ptau/` | powers-of-tau cache, shared by all circuits. Expensive. |
  | `scripts/` | the pipeline |

  ## Notes
  
  `ptau/` is phase 1: universal, circuit-independent, reusable forever. `build/<name>/*.zkey`
  is phase 2: circuit-specific, and invalid the moment you edit the circuit. `prove` refuses
  to run against a stale zkey rather than failing with a confusing `Invalid proof`.

  `power` caps the circuit at `2^power` constraints. 12 is fine for toys; the pour circuit
  needs 16.
  
  The exported verifier is a build artifact but is committed, so the repo compiles without
  re-running the ceremony. Never edit it by hand.

  The trusted setup here has a single contributor — fine for testnet, **not** fine for real
  value. Whoever holds the toxic waste can forge proofs.

  Two things I dropped from your current version deliberately: the commented-out block of raw commands (the scripts are the source of truth now, and a stale copy will drift), and
  the --c flag that was in it (the C++ witness generator isn't used). If you want to keep the raw commands for interview recall, docs/ is a better home than a commented-out block at
  the top of the README.
