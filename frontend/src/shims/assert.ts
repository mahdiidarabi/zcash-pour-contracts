// Browser stand-in for Node's `assert`.
//
// circomlibjs's ESM sources (poseidon_reference.js, poseidon_opt.js) do
// `import assert from "assert"`. There is no such module in a browser, and a
// bundler targeting the browser will happily resolve it to an empty object.
// The failure then surfaces at runtime as "<minified name> is not a function"
// from inside Poseidon, which says nothing useful.
//
// Whether that stub or a real implementation ends up in the bundle depends on
// what happens to be present in node_modules at build time -- which made builds
// non-deterministic between machines. Aliasing it to this file removes the
// guesswork: assert is always a real function.

export default function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? "assertion failed");
  }
}

export function ok(value: unknown, message?: string): asserts value {
  assert(value, message);
}

export function equal(actual: unknown, expected: unknown, message?: string): void {
  assert(actual == expected, message ?? `${String(actual)} != ${String(expected)}`);
}
