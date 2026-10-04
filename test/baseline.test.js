import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { writeBaseline } from "../lib/init.js";
import { runCli } from "../lib/cli.js";
import { tempDir, makeIo } from "./helpers.js";
import "../lib/commands.js";

describe("baseline command and writeBaseline", () => {
  it("baselines both depcruise and eslint when both configs are present", async () => {
    const dir = await tempDir();
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, ".dependency-cruiser.cjs"), "module.exports = {};");
    await fs.writeFile(path.join(dir, "eslint.config.mjs"), "export default [];");

    const execCalls = [];
    const fakeExec = async (cmd, args) => {
      execCalls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    };

    const result = await writeBaseline({ targetDir: dir, exec: fakeExec });
    expect(result.depcruise).toEqual({ code: 0, file: ".dependency-cruiser-known-violations.json" });
    expect(result.eslint).toEqual({ code: 0, file: ".eslint-suppressions.json" });

    expect(execCalls.length).toBe(2);
    expect(execCalls[0].args).toContain("depcruise");
    expect(execCalls[0].args).toContain(".dependency-cruiser-known-violations.json");
    expect(execCalls[1].args).toContain("eslint");
    expect(execCalls[1].args).toContain("--suppress-all");
    expect(execCalls[1].args).toContain(".eslint-suppressions.json");
  });

  it("baselines only eslint when src/ does not exist", async () => {
    const dir = await tempDir();
    await fs.writeFile(path.join(dir, "eslint.config.mjs"), "export default [];");

    const execCalls = [];
    const fakeExec = async (cmd, args) => {
      execCalls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    };

    const result = await writeBaseline({ targetDir: dir, exec: fakeExec });
    expect(result.depcruise).toBeNull();
    expect(result.eslint).toEqual({ code: 0, file: ".eslint-suppressions.json" });
    expect(execCalls.length).toBe(1);
  });

  it("baseline CLI says no baselineable tools when empty project", async () => {
    const dir = await tempDir();
    const io = makeIo(dir);
    const code = await runCli(["baseline"], io);
    expect(code).toBe(0);
    expect(io.out).toContain("No baselineable tools found");
  });
});
