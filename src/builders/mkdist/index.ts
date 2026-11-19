import { promises as fsp } from "node:fs";
import { dirname, extname, join, normalize, relative } from "pathe";
import { mkdist, type MkdistOptions } from "mkdist";
import { symlink, rmdir, warn } from "../../utils";
import type { MkdistBuildEntry, BuildContext } from "../../types";
import consola from "consola";

const ESM_RESOLVE_EXTENSIONS = [
  "",
  "/index.mjs",
  "/index.js",
  ".mjs",
  ".ts",
  ".js",
];
const CJS_RESOLVE_EXTENSIONS = ["", "/index.cjs", ".cjs"];

async function resolveRelativeImports(writtenFiles: string[]): Promise<void> {
  const outPaths = new Set(writtenFiles.map((file) => normalize(file)));
  const resolveId = (
    from: string,
    id: string,
    resolveExtensions: string[],
  ): string => {
    if (!id.startsWith(".")) {
      return id;
    }
    for (const extension of resolveExtensions) {
      if (outPaths.has(join(dirname(from), id + extension))) {
        return id + extension;
      }
    }
    return id;
  };

  await Promise.all(
    [...outPaths].map(async (filePath) => {
      const ext = extname(filePath);
      if (ext !== ".mjs" && ext !== ".js" && ext !== ".cjs") {
        return;
      }
      const contents = await fsp.readFile(filePath, "utf8");
      const updated =
        ext === ".cjs"
          ? contents.replace(
              /require\((["'])([^"']+)(["'])\)/g,
              (_, head, id, tail) =>
                "require(" +
                head +
                resolveId(filePath, id, CJS_RESOLVE_EXTENSIONS) +
                tail +
                ")",
            )
          : contents
              .replace(
                /(import|export)(\s+(?:.+?|{[\s\w,]+})\s+from\s+["'])([^"']+)(["'])/g,
                (_, type, head, id, tail) =>
                  type +
                  head +
                  resolveId(filePath, id, ESM_RESOLVE_EXTENSIONS) +
                  tail,
              )
              .replace(
                /import\((["'])([^"']+)(["'])\)/g,
                (_, head, id, tail) =>
                  "import(" +
                  head +
                  resolveId(filePath, id, ESM_RESOLVE_EXTENSIONS) +
                  tail +
                  ")",
              );
      if (updated !== contents) {
        await fsp.writeFile(filePath, updated, "utf8");
      }
    }),
  );
}

export async function mkdistBuild(ctx: BuildContext): Promise<void> {
  const entries = ctx.options.entries.filter(
    (e) => e.builder === "mkdist",
  ) as MkdistBuildEntry[];
  await ctx.hooks.callHook("mkdist:entries", ctx, entries);
  const writtenFiles: string[] = [];
  for (const entry of entries) {
    const distDir = entry.outDir!;
    if (ctx.options.stub) {
      await rmdir(distDir);
      await symlink(entry.input, distDir);
    } else {
      const mkdistOptions: MkdistOptions = {
        rootDir: ctx.options.rootDir,
        srcDir: entry.input,
        distDir,
        cleanDist: false,
        ...entry,
      };
      await ctx.hooks.callHook(
        "mkdist:entry:options",
        ctx,
        entry,
        mkdistOptions,
      );
      const output = await mkdist(mkdistOptions);
      writtenFiles.push(...output.writtenFiles);
      ctx.buildEntries.push({
        path: distDir,
        chunks: output.writtenFiles.map((p) => relative(ctx.options.outDir, p)),
      });
      await ctx.hooks.callHook("mkdist:entry:build", ctx, entry, output);
      if (output.errors) {
        for (const error of output.errors) {
          warn(
            ctx,
            `mkdist build failed for \`${relative(ctx.options.rootDir, error.filename)}\`:\n${error.errors.map((e) => `  - ${e}`).join("\n")}`,
          );
        }
      }
    }
  }
  if (!ctx.options.stub && entries.length > 1) {
    await resolveRelativeImports(writtenFiles);
  }
  await ctx.hooks.callHook("mkdist:done", ctx);

  if (entries.length > 0 && ctx.options.watch) {
    consola.warn("`mkdist` builder does not support watch mode yet.");
  }
}
