import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { describe, it, expect, afterEach } from "vitest";
import { build } from "../src/build";

describe("mkdist builder", () => {
  const tmpDirs: string[] = [];

  async function createTmpDir(): Promise<string> {
    const dir = await fsp.mkdtemp(join(tmpdir(), "unbuild-mkdist-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves relative imports across multiple mkdist entries (js)", async () => {
    const rootDir = await createTmpDir();
    await fsp.mkdir(join(rootDir, "src/common/config"), { recursive: true });
    await fsp.mkdir(join(rootDir, "src/runtime/config"), { recursive: true });

    await fsp.writeFile(
      join(rootDir, "src/common/config/index.ts"),
      `export const COMMON_CONFIG = { name: "common" };\n`,
    );
    await fsp.writeFile(
      join(rootDir, "src/common/helper.ts"),
      `export const helper = () => "ok";\n`,
    );
    await fsp.writeFile(
      join(rootDir, "src/runtime/config/index.ts"),
      `export const RUNTIME_CONFIG = { name: "runtime" };\n`,
    );
    await fsp.writeFile(
      join(rootDir, "src/runtime/fn.ts"),
      [
        `import { COMMON_CONFIG } from "../common/config";`,
        `import { helper } from "../common/helper";`,
        `import { RUNTIME_CONFIG } from "./config";`,
        `export { COMMON_CONFIG } from "../common/config";`,
        `export const getConfigs = () => [COMMON_CONFIG, RUNTIME_CONFIG, helper()];`,
        `export const loadHelper = () => import("../common/helper");`,
        ``,
      ].join("\n"),
    );

    await build(rootDir, false, {
      entries: [
        {
          builder: "mkdist",
          input: "./src/common/",
          outDir: "./dist/common/",
          ext: "js",
        },
        {
          builder: "mkdist",
          input: "./src/runtime/",
          outDir: "./dist/runtime/",
          ext: "js",
        },
      ],
    });

    const runtimeFn = await fsp.readFile(
      join(rootDir, "dist/runtime/fn.js"),
      "utf8",
    );
    expect(runtimeFn).toContain(
      `import { COMMON_CONFIG } from "../common/config/index.js"`,
    );
    expect(runtimeFn).toContain(`import { helper } from "../common/helper.js"`);
    expect(runtimeFn).toContain(
      `import { RUNTIME_CONFIG } from "./config/index.js"`,
    );
    expect(runtimeFn).toContain(
      `export { COMMON_CONFIG } from "../common/config/index.js"`,
    );
    expect(runtimeFn).toContain(`import("../common/helper.js")`);
  });

  it("resolves relative imports across multiple mkdist entries (mjs)", async () => {
    const rootDir = await createTmpDir();
    await fsp.mkdir(join(rootDir, "src/common/config"), { recursive: true });
    await fsp.mkdir(join(rootDir, "src/runtime"), { recursive: true });

    await fsp.writeFile(
      join(rootDir, "src/common/config/index.ts"),
      `export const COMMON_CONFIG = { name: "common" };\n`,
    );
    await fsp.writeFile(
      join(rootDir, "src/runtime/fn.ts"),
      `import { COMMON_CONFIG } from "../common/config";\nexport const getConfig = () => COMMON_CONFIG;\n`,
    );

    await build(rootDir, false, {
      entries: [
        {
          builder: "mkdist",
          input: "./src/common/",
          outDir: "./dist/common/",
        },
        {
          builder: "mkdist",
          input: "./src/runtime/",
          outDir: "./dist/runtime/",
        },
      ],
    });

    const runtimeFn = await fsp.readFile(
      join(rootDir, "dist/runtime/fn.mjs"),
      "utf8",
    );
    expect(runtimeFn).toContain(
      `import { COMMON_CONFIG } from "../common/config/index.mjs"`,
    );
  });

  it("resolves relative require across multiple cjs mkdist entries", async () => {
    const rootDir = await createTmpDir();
    await fsp.mkdir(join(rootDir, "src/common/config"), { recursive: true });
    await fsp.mkdir(join(rootDir, "src/runtime"), { recursive: true });

    await fsp.writeFile(
      join(rootDir, "src/common/config/index.ts"),
      `export const COMMON_CONFIG = { name: "common" };\n`,
    );
    await fsp.writeFile(
      join(rootDir, "src/runtime/fn.ts"),
      `import { COMMON_CONFIG } from "../common/config";\nexport const getConfig = () => COMMON_CONFIG;\n`,
    );

    await build(rootDir, false, {
      entries: [
        {
          builder: "mkdist",
          input: "./src/common/",
          outDir: "./dist/common/",
          format: "cjs",
          ext: "cjs",
        },
        {
          builder: "mkdist",
          input: "./src/runtime/",
          outDir: "./dist/runtime/",
          format: "cjs",
          ext: "cjs",
        },
      ],
    });

    const runtimeFn = await fsp.readFile(
      join(rootDir, "dist/runtime/fn.cjs"),
      "utf8",
    );
    expect(runtimeFn).toContain(`require("../common/config/index.cjs")`);
  });
});
