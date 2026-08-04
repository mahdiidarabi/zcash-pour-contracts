// A note is (sk, rho, r, value). Everything else is derived from it.
// See docs/protocol.md section 3.
//
//   pk         = Poseidon(sk)                 recipient identifier
//   snProduce  = Poseidon(rho, pk)            the note's serial
//   cm         = Poseidon(r, snProduce, v)    what goes on chain
//   snConsume  = Poseidon(snProduce, sk)      the nullifier, published on spend
//
// Only the holder of sk can build snConsume, and that is the whole ownership
// argument -- so sk is the one value that must never leave the owner.

const { randomField } = require("./field");
const { hashes } = require("./poseidon");

async function deriveNote({ sk, rho, r, value }) {
  const { hash1, hash2, hash3 } = await hashes();

  const pk = hash1(sk);
  const snProduce = hash2(rho, pk);
  const cm = hash3(r, snProduce, value);
  const snConsume = hash2(snProduce, sk);

  return { sk, rho, r, value, pk, snProduce, cm, snConsume };
}

// A brand new note worth `value` wei, owned by a fresh key.
async function createNote(value) {
  return deriveNote({
    sk: randomField(),
    rho: randomField(),
    r: randomField(),
    value,
  });
}

// A note you are paying to someone else: you pick the randomness, they keep the
// sk. Without sk there is no snConsume, which is why this returns no nullifier.
async function deriveOutput({ pk, r, rho, value }) {
  const { hash2, hash3 } = await hashes();

  const snProduce = hash2(rho, pk);
  const cm = hash3(r, snProduce, value);

  return { pk, r, rho, value, snProduce, cm };
}

// BigInt does not survive JSON.stringify, so notes cross the file boundary as
// decimal strings -- the same form circom and ethers both accept.
function toJson(note) {
  return Object.fromEntries(
    Object.entries(note).map(([k, v]) => [k, v.toString()])
  );
}

function fromJson(json) {
  return Object.fromEntries(
    Object.entries(json).map(([k, v]) => [k, BigInt(v)])
  );
}

module.exports = { createNote, deriveNote, deriveOutput, toJson, fromJson };
