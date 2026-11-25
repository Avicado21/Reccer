// Renders the recommender pages against fixture data with no SDK and no backend.
// Needs: npm i -D esbuild react react-dom playwright   (then: npx playwright install chromium)
// Run from this folder: node build.mjs && open index.html?page=interview  (or ?page=draft)
import * as esbuild from "esbuild";
const mock = { name: "mock", setup(b) { b.onResolve({ filter: /lib\/api$/ }, () => ({ path: new URL("./mockApi.ts", import.meta.url).pathname })); } };
await esbuild.build({ entryPoints: ["entry.tsx"], bundle: true, outfile: "out.js", jsx: "automatic", plugins: [mock],
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
