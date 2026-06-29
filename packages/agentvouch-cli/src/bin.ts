#!/usr/bin/env node

// Must run before ./cli.js so the Node-version check happens before the heavy
// dependency graph (Solana / rpc-websockets) is evaluated. ESM evaluates
// imports in source order, so this side-effect import gates everything below.
import "./preflight.js";
import { buildProgram } from "./cli.js";

await buildProgram().parseAsync(process.argv);
