  #!/usr/bin/env bash
  #
  # Full pipeline: compile -> setup -> export verifier.
  # Deliberately excludes 'prove', which needs an input file.
  #
  #   npm run all                # Multiplier, POWER=12
  #   npm run all pour 16
  #
  set -euo pipefail
  cd "$(dirname "$0")/.."

  CIRCUIT="${1:-${CIRCUIT:-Multiplier}}"
  POWER="${2:-${POWER:-12}}"

  bash scripts/compile.sh         "$CIRCUIT"
  bash scripts/setup.sh           "$CIRCUIT" "$POWER"
  bash scripts/export-verifier.sh "$CIRCUIT"

