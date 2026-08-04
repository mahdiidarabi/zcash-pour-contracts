// Minimal --flag value parser. No aliases, no types, no framework.
// A flag with no value after it is treated as a boolean.

function parseArgs(argv) {
  const out = {};

  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;

    const key = argv[i].slice(2);
    const next = argv[i + 1];

    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }

  return out;
}

// Flags are almost always required, and a missing one should say so rather than
// blowing up later as `BigInt(undefined)`.
function required(args, name, usage) {
  if (args[name] === undefined || args[name] === true) {
    console.error(`missing --${name}\n\n${usage}`);
    process.exit(1);
  }
  return args[name];
}

module.exports = { parseArgs, required };
