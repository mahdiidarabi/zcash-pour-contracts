// The BN254 scalar field. Every value in a note is an element of it.

const crypto = require("crypto");

const P =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Random field element, by rejection.
//
// The obvious `random256Bits % P` is biased: 2^256 is only ~5.3 P, so the
// bottom ~29% of the field would come up noticeably more often. Secrets have to
// be uniform, so redraw instead. ~5 draws on average, and this is never hot.
function randomField() {
  for (;;) {
    const x = BigInt("0x" + crypto.randomBytes(32).toString("hex"));
    if (x < P) return x;
  }
}

module.exports = { P, randomField };
