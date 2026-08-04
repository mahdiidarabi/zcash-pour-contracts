// Limits the circuit imposes on values. Keep these in step with
// pour_circuit() in circuits/ZcashPour.circom -- if the Num2Bits width there
// changes, change POUR_VALUE_BITS here and nowhere else.

const POUR_VALUE_BITS = 128;

// pour() splits v into v1 + v2 and range-checks both, so no single poured
// output can reach this. A note at or above it can be minted and burned but
// never poured: no witness satisfies the range check.
const MAX_POUR_VALUE = 2n ** BigInt(POUR_VALUE_BITS);

module.exports = { POUR_VALUE_BITS, MAX_POUR_VALUE };
