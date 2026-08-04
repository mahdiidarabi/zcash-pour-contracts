// Build the witness input for a pour: spend one note, create two.
//
//   node tools/pour-input.js \
//     --note notes/alice.json \
//     --cm-list cmlist.json \
//     --v1 40 --pk1 <field> \
//     --v2 60 --pk2 <field> \
//     --out inputs/pour1.json > outputs.json
//
// --out gets the circom input, which must contain exactly the circuit's input
// signals and nothing else. stdout gets the two output notes, because whoever
// you paid cannot spend theirs without the r and rho picked here.

const fs = require("fs");
const path = require("path");
const { parseArgs, required } = require("../lib/args");
const { randomField } = require("../lib/field");
const { deriveNote, deriveOutput, toJson } = require("../lib/note");
const { MAX_POUR_VALUE, POUR_VALUE_BITS } = require("../lib/limits");

const CM_LIST_SIZE = 10;

const USAGE = `usage: node tools/pour-input.js --note <file> --cm-list <file> \\
         --v1 <wei> --pk1 <field> --v2 <wei> --pk2 <field> --out <file>

  --note     the note being spent
  --cm-list  JSON array of ${CM_LIST_SIZE} commitments already in the pool,
             one of which must be this note's cm
  --v1 --pk1 value and recipient key of the first new note
  --v2 --pk2 value and recipient key of the second new note
  --out      where to write the circom input`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function checkValue(name, v) {
  if (v < 0n) fail(`--${name} cannot be negative`);
  if (v >= MAX_POUR_VALUE) {
    fail(
      `--${name} ${v} is too big.\n\n` +
        `pour range-checks each output with Num2Bits(${POUR_VALUE_BITS}), so a\n` +
        `poured value must stay under ${MAX_POUR_VALUE}.`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const note = JSON.parse(fs.readFileSync(required(args, "note", USAGE), "utf8"));
  const cmList = JSON.parse(fs.readFileSync(required(args, "cm-list", USAGE), "utf8")).map(String);

  const v1 = BigInt(required(args, "v1", USAGE));
  const v2 = BigInt(required(args, "v2", USAGE));
  const pk1 = BigInt(required(args, "pk1", USAGE));
  const pk2 = BigInt(required(args, "pk2", USAGE));
  const out = required(args, "out", USAGE);

  if (cmList.length !== CM_LIST_SIZE) {
    fail(`--cm-list needs exactly ${CM_LIST_SIZE} entries, got ${cmList.length}`);
  }

  // Re-derive rather than trust the file: a hand-edited note would otherwise
  // produce a witness that fails deep inside the prover.
  const spent = await deriveNote({
    sk: BigInt(note.sk),
    rho: BigInt(note.rho),
    r: BigInt(note.r),
    value: BigInt(note.value),
  });

  if (spent.cm.toString() !== note.cm) {
    fail(`note is inconsistent: cm does not match its own secrets`);
  }

  // The circuit proves cm_list[j] == the spent commitment, so it has to be in
  // there. The contract separately checks every entry really exists on chain.
  const j = cmList.indexOf(spent.cm.toString());
  if (j === -1) {
    fail(
      `this note's cm is not in --cm-list.\n\n` +
        `pour proves the spent note is one of the listed commitments, so the\n` +
        `list must contain ${spent.cm}`
    );
  }

  checkValue("v1", v1);
  checkValue("v2", v2);
  if (v1 + v2 !== spent.value) {
    fail(`v1 + v2 must equal the note value: ${v1} + ${v2} != ${spent.value}`);
  }

  // Fresh randomness per output. Reusing rho across notes for the same pk gives
  // them the same nullifier and only one becomes spendable.
  const out1 = await deriveOutput({ pk: pk1, r: randomField(), rho: randomField(), value: v1 });
  const out2 = await deriveOutput({ pk: pk2, r: randomField(), rho: randomField(), value: v2 });

  const input = {
    cm_list: cmList,
    v: spent.value.toString(),
    j: String(j),
    r_old: spent.r.toString(),
    sk_old: spent.sk.toString(),
    rho: spent.rho.toString(),
    sn_consume: spent.snConsume.toString(),
    v1: v1.toString(),
    r1: out1.r.toString(),
    rho1: out1.rho.toString(),
    pk1: pk1.toString(),
    v2: v2.toString(),
    r2: out2.r.toString(),
    rho2: out2.rho.toString(),
    pk2: pk2.toString(),
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(input, null, 2) + "\n");

  console.error(`wrote ${out}  (spending cm_list[${j}])`);
  console.error(`next: CIRCUIT=ZcashPour INPUT=${out} npm run prove`);

  // The recipients need r, rho and value to rebuild their note; combined with
  // their own sk that is a spendable coin. Hand these over out of band -- the
  // chain only ever sees the commitment.
  console.log(
    JSON.stringify(
      { j, snConsume: spent.snConsume.toString(), outputs: [toJson(out1), toJson(out2)] },
      null,
      2
    )
  );
}

main();
