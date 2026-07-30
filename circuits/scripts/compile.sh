 #!/usr/bin/env bash
  #
  # Compile a circom circuit to r1cs / wasm / sym.
  #
  #   npm run compile                  # compiles Multiplier
  #   CIRCUIT=pour npm run compile     # compiles pour
  #
  set -euo pipefail
  cd "$(dirname "$0")/.."

  CIRCUIT="${CIRCUIT:-Multiplier}"
  SRC="circuits/${CIRCUIT}.circom"
  BUILD="build/${CIRCUIT}"

  if ! command -v circom >/dev/null 2>&1; then
    echo "error: circom not on PATH -- https://docs.circom.io/getting-started/installation/" >&2
    exit 1
  fi

  if [ ! -f "$SRC" ]; then
    echo "error: $SRC not found" >&2
    exit 1
  fi

  mkdir -p "$BUILD"

  echo "==> compiling $SRC"
  # -l node_modules lets you `include "circomlib/circuits/poseidon.circom"`.
  # No --c on purpose: the C++ witness generator is faster but needs its own
  # build step, and wasm is plenty at this size.
  circom "$SRC" --r1cs --wasm --sym -o "$BUILD" -l node_modules

  echo
  echo "==> circuit info"
  npx snarkjs r1cs info "${BUILD}/${CIRCUIT}.r1cs"

  echo
  echo "wrote ${BUILD}/"
  echo "next: CIRCUIT=$CIRCUIT npm run setup"