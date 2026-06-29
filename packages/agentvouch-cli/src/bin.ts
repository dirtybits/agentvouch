#!/usr/bin/env node

// Must run before ./cli.js so the Node-version check happens before the heavy
// dependency graph (Solana / rpc-websockets) is evaluated. Keep ./cli.js behind
// a dynamic import so bundlers cannot hoist those dependencies ahead of this
// side-effect import in the published bin.
import "./preflight.js";

const { buildProgram } = await import("./cli.js");
await buildProgram().parseAsync(process.argv);
