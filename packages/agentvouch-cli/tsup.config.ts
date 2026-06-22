import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist",
  // @agentvouch/protocol is a workspace-only package that is not published to
  // npm. Bundle it into the CLI output so the published package is
  // self-contained and carries no runtime dependency on it. It stays a
  // devDependency purely so the build (and `dev`) can resolve it.
  noExternal: ["@agentvouch/protocol"],
});
