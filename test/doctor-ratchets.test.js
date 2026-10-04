import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { inspectRatchets } from "../lib/doctor.js";
import { runCli } from "../lib/cli.js";
import { tempDir, makeIo } from "./helpers.js";
import { initProject, RECOMMENDED_ANSWERS } from "../lib/init.js";
import "../lib/commands.js";

const NO_HOOKS = { ...RECOMMENDED_ANSWERS, hooks: false };

describe("inspectRatchets and doctor ratchets reporting", () => {
  it("returns empty array when no ratchet files exist", async () => {
    const dir = await tempDir();
    const ratchets = await inspectRatchets(dir);
    expect(ratchets).toEqual([]);
  });

  it("accurately reads and counts all ratchet files", async () => {
    const dir = await tempDir();

    // 1. ESLint suppressions
    await fs.writeFile(
      path.join(dir, ".eslint-suppressions.json"),
      JSON.stringify({
        "src/a.ts": { "@typescript-eslint/no-explicit-any": { count: 4 } },
        "src/b.ts": { "no-unused-vars": { count: 2 }, "no-undef": { count: 1 } },
      })
    );

    // 2. Depcruise violations
    await fs.writeFile(
      path.join(dir, ".dependency-cruiser-known-violations.json"),
      JSON.stringify({
        violations: [{ from: "a", to: "b" }, { from: "c", to: "d" }],
      })
    );

    // 3. Arch allowlist in scripts/
    await fs.mkdir(path.join(dir, "scripts"));
    await fs.writeFile(
      path.join(dir, "scripts/arch-allowlist.json"),
      JSON.stringify({
        _comment: "legacy writes",
        "src/legacy/db.ts": 5,
      })
    );

    // 4. Action gaps
    await fs.writeFile(
      path.join(dir, "scripts/arch-action-gaps.json"),
      JSON.stringify({
        _comment: "legacy actions",
        "src/app/actions/old.ts": ["unguarded"],
      })
    );

    const ratchets = await inspectRatchets(dir);
    expect(ratchets).toHaveLength(4);

    const eslintR = ratchets.find((r) => r.id === "eslint");
    expect(eslintR.count).toBe(7);
    expect(eslintR.details).toContain("7 violations across 2 files");

    const depcruiseR = ratchets.find((r) => r.id === "arch-layers");
    expect(depcruiseR.count).toBe(2);

    const dbWritesR = ratchets.find((r) => r.id === "db-writes");
    expect(dbWritesR.count).toBe(5);

    const gapsR = ratchets.find((r) => r.id === "action-gaps");
    expect(gapsR.count).toBe(1);
  });

  it("doctor CLI prints the technical debt & ratchets summary", async () => {
    const dir = await tempDir();
    const home = await tempDir("oneup-home-");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: { next: "16" } }, null, 2));
    await initProject({ targetDir: dir, answers: NO_HOOKS, homeDir: home });

    await fs.writeFile(
      path.join(dir, ".eslint-suppressions.json"),
      JSON.stringify({
        "src/a.ts": { "@typescript-eslint/no-explicit-any": { count: 3 } },
      })
    );

    const io = makeIo(dir, { HOME: home });
    const code = await runCli(["doctor"], io);
    expect(code).toBe(0);
    expect(io.out).toContain("Technical debt & ratchets");
    expect(io.out).toContain("ESLint suppressions");
    expect(io.out).toContain(".eslint-suppressions.json");
    expect(io.out).toContain("3 violations across 1 file");
  });
});
