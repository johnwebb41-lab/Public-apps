// Builds index.html: a single page with the engine and test results inlined, fonts served from ./fonts.
// Usage: node build.js   (runs the tests first and stops if any fail)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const here = __dirname;
let out;
try {
  out = execSync("node tests/test.js", { cwd: here }).toString();
} catch (e) {
  console.error(e.stdout ? e.stdout.toString() : e.message);
  console.error("Tests failed: index.html not built.");
  process.exit(1);
}
const results = out.split("\n").filter((l) => /^(PASS|FAIL) /.test(l)).map((l) => [l.slice(0, 4), l.slice(5)]);

let page = fs.readFileSync(path.join(here, "src/page.html"), "utf8");
page = page
  .replace("/*ENGINE*/", () => fs.readFileSync(path.join(here, "src/engine.js"), "utf8"))
  .replace("/*QA*/[]", () => JSON.stringify(results))
  // Local fonts instead of Google Fonts, so visitors' details are not sent to a third party.
  .replace(/<link rel="preconnect"[^>]*>\s*/, "")
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, `<style>
@font-face { font-family: "Archivo"; src: url("fonts/archivo-wdth.woff2") format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; font-display: swap; }
@font-face { font-family: "IBM Plex Sans"; src: url("fonts/ibm-plex-sans-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "IBM Plex Sans"; src: url("fonts/ibm-plex-sans-500.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "IBM Plex Sans"; src: url("fonts/ibm-plex-sans-600.woff2") format("woff2"); font-weight: 600; font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; src: url("fonts/ibm-plex-mono-400.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "IBM Plex Mono"; src: url("fonts/ibm-plex-mono-500.woff2") format("woff2"); font-weight: 500; font-display: swap; }
</style>`);

// Head material (title, meta, styles) goes in <head>; the rest is the body.
const split = page.indexOf('<div class="wrap">');
const head = page.slice(0, split), body = page.slice(split);

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Pipeline Health Check: a RevOps command view on fictitious data, built by John Webb with AI.">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(here, "index.html"), html);
const fails = results.filter((r) => r[0] === "FAIL").length;
console.log(`Built index.html (${html.length.toLocaleString()} bytes): ${results.length} tests, ${fails} failed.`);
