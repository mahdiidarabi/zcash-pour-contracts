// Node globals the crypto libraries expect, which Vite does not shim.
//
// circomlibjs has a single entry point that re-exports everything, so bundling
// it pulls in eddsa.js, pedersen_hash.js and testblake.js -- none of which this
// app calls, all of which reference `Buffer` at module scope. ffjavascript reads
// `process.browser`. Neither exists in a browser, and the failure shows up as
// "Buffer is not defined" the first time a note is derived.
//
// Imported for its side effects, and it must run before anything that touches
// circomlibjs -- main.ts imports it first, and every screen is loaded
// dynamically afterwards.
//
// note.test.ts has a case that deletes globalThis.Buffer to keep this honest.

import { Buffer } from "buffer";

const globals = globalThis as Record<string, unknown>;

if (globals.Buffer === undefined) {
  globals.Buffer = Buffer;
}

if (globals.process === undefined) {
  globals.process = { browser: true, env: {}, version: "" };
}

export {};
