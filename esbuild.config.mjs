import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  outfile: "main.js",
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
