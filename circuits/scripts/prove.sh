#!/usr/bin/env bash
  #
  # Generate a witness, prove it, and verify the proof locally.
  #
  #   npm run prove
  #   CIRCUIT=pour INPUT=inputs/pour.deposit.json npm run prove
  #
  set -euo pipefail
  cd "$(dirname "$0")/.."
  
  CIRCUIT="${CIRCUIT:-Multiplier}"
  BUILD="build/${CIRCUIT}"
  INPUT="${INPUT:-inputs/${CIRCUIT}.json}"

  sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
  }

  for f in "${BUILD}/${CIRCUIT}_final.zkey" "${BUILD}/${CIRCUIT}_js/${CIRCUIT}.wasm"; do
    if [ ! -f "$f" ]; then
      echo "error: $f not found -- run compile and setup first" >&2
      exit 1
    fi
  done
  
  if [ ! -f "$INPUT" ]; then
    echo "error: input file $INPUT not found" >&2
    exit 1
  fi

  # A recompiled circuit silently invalidates the zkey. Catch it here rather than
  # in a confusing 'Invalid proof' twenty seconds later.
  if [ -f "${BUILD}/.r1cs.sha256" ]; then
    if [ "$(sha256 "${BUILD}/${CIRCUIT}.r1cs")" != "$(cat "${BUILD}/.r1cs.sha256")" ]; then
      echo "error: ${CIRCUIT}.r1cs has changed since the zkey was built." >&2
      echo "       the circuit was recompiled -- re-run 'npm run setup'." >&2
      exit 1
    fi
  fi
  
  echo "==> witness  ($INPUT)"
  node "${BUILD}/${CIRCUIT}_js/generate_witness.js" \
    "${BUILD}/${CIRCUIT}_js/${CIRCUIT}.wasm" \
    "$INPUT" \
    "${BUILD}/witness.wtns"

  echo
  echo "==> proving"
  npx snarkjs groth16 prove \
    "${BUILD}/${CIRCUIT}_final.zkey" \
    "${BUILD}/witness.wtns" \
    "${BUILD}/proof.json" \
    "${BUILD}/public.json"
  
  echo
  echo "==> verifying"
  npx snarkjs groth16 verify \
    "${BUILD}/verification_key.json" \
    "${BUILD}/public.json" \
    "${BUILD}/proof.json"

  echo
  echo "public signals:"
  cat "${BUILD}/public.json"