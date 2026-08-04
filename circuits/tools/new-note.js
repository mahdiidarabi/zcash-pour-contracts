// Make a fresh note and print everything mint() needs.
//
//   node tools/new-note.js --value 100 --name alice   # -> notes/alice.json
//   node tools/new-note.js --value 100 > alice.json   # or just take stdout
//
// stdout is the note as JSON. stderr is for humans, so the redirect above stays
// clean. The file holds sk -- whoever has it owns the coin.

const fs = require("fs");
const path = require("path");
const { parseArgs, required } = require("../lib/args");
const { createNote, toJson } = require("../lib/note");

const USAGE = `usage: node tools/new-note.js --value <wei> [--name <name>] [--allow-big]

  --value      note value in wei
  --name       write to notes/<name>.json instead of stdout
  --allow-big  permit a value the pour circuit cannot spend (see below)`;

// pour() splits v into v1 + v2 and range-checks both with Num2Bits(32), so an
// output can never reach 2^32. A note at or above that can be minted and burned
// but never poured -- there is no witness that satisfies the range check.
// docs/protocol.md section 10.
const MAX_POURABLE = 2n ** 32n;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const value = BigInt(required(args, "value", USAGE));

  if (value <= 0n) {
    console.error("--value must be positive (mint requires _value > 0)");
    process.exit(1);
  }

  if (value >= MAX_POURABLE && !args["allow-big"]) {
    console.error(
      `--value ${value} is too big to pour.\n\n` +
        `pour() range-checks both outputs with Num2Bits(32), so a poured value\n` +
        `must stay under ${MAX_POURABLE} wei (~4.29 gwei). This note could be\n` +
        `minted and burned, but never poured.\n\n` +
        `Pass --allow-big if you only need mint and burn.`
    );
    process.exit(1);
  }

  const note = await createNote(value);

  const json = JSON.stringify(
    {
      ...toJson(note),
      // The four mint() arguments, in the order the contract takes them.
      mint: {
        _value: note.value.toString(),
        _cm: note.cm.toString(),
        _r: note.r.toString(),
        _snProduce: note.snProduce.toString(),
      },
    },
    null,
    2
  );

  if (args.name) {
    const file = path.join(__dirname, "..", "notes", `${args.name}.json`);

    // Overwriting a note destroys a coin -- there is no recovery without sk.
    if (fs.existsSync(file)) {
      console.error(`notes/${args.name}.json already exists, refusing to overwrite`);
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json + "\n");
    console.error(`wrote notes/${args.name}.json`);
  } else {
    console.log(json);
  }

  console.error("keep sk secret -- it is the coin");
  if (value >= MAX_POURABLE) {
    console.error("warning: not pourable, mint and burn only");
  }
}

main();
