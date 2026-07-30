#!/usr/bin/env bash
  #
  # Groth16 trusted setup.
  #
  #   Phase 1 (powers of tau) is universal and circuit-independent. Cached in
  #   ptau/ and reused by every circuit, so it only runs once per POWER.
  #
  #   Phase 2 (zkey) is circuit-specific and becomes INVALID the moment you edit
  #   the circuit. Lives in build/<CIRCUIT>/ and is disposable.
  #
  #   npm run setup
  #   POWER=16 CIRCUIT=pour npm run setup
  #
  # NOTE: a single-contributor ceremony is fine for testnet and NOT fine for real
  # value -- whoever holds the toxic waste can forge proofs. See docs/protocol.md.
  #
  set -euo pipefail
  cd "$(dirname "$0")/.."

  CIRCUIT="${CIRCUIT:-Multiplier}"
  POWER="${POWER:-12}"
  BUILD="build/${CIRCUIT}"
  PTAU="ptau/pot${POWER}_final.ptau"

  sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    else shasum -a 256 "$1" | cut -d' ' -f1; fi
  }

  # snarkjs prompts interactively for entropy unless -e is supplied, which would
  # block automation.
  entropy() { head -c 64 /dev/urandom | base64 | tr -d '\n'; }

  if [ ! -f "${BUILD}/${CIRCUIT}.r1cs" ]; then
    echo "error: ${BUILD}/${CIRCUIT}.r1cs not found -- run 'npm run compile' first" >&2
    exit 1
  fi

  mkdir -p ptau

  # ---------- phase 1: powers of tau (cached) ----------
  if [ ! -f "$PTAU" ]; then
    echo "==> phase 1: generating powers of tau (2^${POWER})"
    npx snarkjs powersoftau new bn128 "$POWER" "ptau/pot${POWER}_0000.ptau" -v
    npx snarkjs powersoftau contribute \
      "ptau/pot${POWER}_0000.ptau" "ptau/pot${POWER}_0001.ptau" \
      --name="first contribution" -v -e="$(entropy)"
    npx snarkjs powersoftau prepare phase2 \
      "ptau/pot${POWER}_0001.ptau" "$PTAU" -v
    rm -f "ptau/pot${POWER}_0000.ptau" "ptau/pot${POWER}_0001.ptau"
  else
    echo "==> phase 1: using cached $PTAU"
  fi

  # ---------- phase 2: circuit-specific zkey ----------
  echo
  echo "==> phase 2: groth16 setup"
  npx snarkjs groth16 setup \
    "${BUILD}/${CIRCUIT}.r1cs" "$PTAU" "${BUILD}/${CIRCUIT}_0000.zkey"

  echo
  echo "==> phase 2: contributing"
  npx snarkjs zkey contribute \
    "${BUILD}/${CIRCUIT}_0000.zkey" "${BUILD}/${CIRCUIT}_final.zkey" \
    --name="zcash-pour-contracts mvp" -v -e="$(entropy)"

  echo
  echo "==> exporting verification key"
  npx snarkjs zkey export verificationkey \
    "${BUILD}/${CIRCUIT}_final.zkey" "${BUILD}/verification_key.json"

  rm -f "${BUILD}/${CIRCUIT}_0000.zkey"

  # Record which r1cs this zkey was built from, so prove.sh can detect a circuit
  # that was recompiled without re-running setup.
  sha256 "${BUILD}/${CIRCUIT}.r1cs" > "${BUILD}/.r1cs.sha256"

  echo
  echo "wrote ${BUILD}/${CIRCUIT}_final.zkey"
  echo "      ${BUILD}/verification_key.json"
  echo "next: CIRCUIT=$CIRCUIT npm run prove"