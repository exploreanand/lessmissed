#!/usr/bin/env node
// Render one URL to a local file. No database, no S3, no queue.
//
// This is the fastest way to answer "does capture work, and does it look
// right?" — and the fastest way to tune mask/dismiss selectors for an awkward
// page before committing them to a page's configuration.
//
//   node src/capture-once.js https://example.com
//   node src/capture-once.js https://shop.com/pricing --breakpoint mobile
//   node src/capture-once.js https://news.site --mask ".ticker" --mask "#ad-slot"
//   node src/capture-once.js https://eu.site --dismiss "#accept-all"
//
// It deliberately shares renderPage() with the worker rather than
// reimplementing it, so what you see here is exactly what the worker stores.

import fs from "node:fs";
import path from "node:path";
import { renderPage, BrowserPool } from "./render.js";
import { perceptualHash, contentHash, imageDiff } from "./diff.js";

function parseArgs(argv) {
  const args = { masks: [], dismiss: [], breakpoint: "desktop", out: null, compare: null };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mask") args.masks.push(argv[++i]);
    else if (arg === "--dismiss") args.dismiss.push(argv[++i]);
    else if (arg === "--breakpoint") args.breakpoint = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    // Diff this render against an earlier one, to see what the worker would
    // decide: store a new version, or throw the render away as unchanged.
    else if (arg === "--compare") args.compare = argv[++i];
    else if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
    else positional.push(arg);
  }

  args.url = positional[0];
  return args;
}

const USAGE = `
Usage: node src/capture-once.js <url> [options]

  --breakpoint <desktop|mobile>  Device profile to render at (default: desktop)
  --mask <selector>              Paint over a selector; repeatable
  --dismiss <selector>           Click a selector before capture; repeatable
  --out <file>                   Where to write the JPEG (default: ./capture-<host>.jpg)
  --compare <file>               Diff against an earlier capture and report the verdict
`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(1);
  }

  if (!args.url) {
    console.error(USAGE);
    process.exit(1);
  }

  const host = safeHost(args.url);
  const outPath = path.resolve(args.out ?? `capture-${host}-${args.breakpoint}.jpg`);

  const pool = new BrowserPool();
  console.log(`Rendering ${args.url} at ${args.breakpoint}...`);

  try {
    const render = await renderPage({
      pool,
      url: args.url,
      breakpoint: args.breakpoint,
      maskSelectors: args.masks,
      dismissSelectors: args.dismiss,
      // No expectedHostname: this is an operator running a one-off against a
      // URL they typed themselves. The SSRF range checks still apply.
      onProgress: () => {},
    });

    fs.writeFileSync(outPath, render.buffer);
    const thumbPath = outPath.replace(/\.jpg$/, ".thumb.jpg");
    fs.writeFileSync(thumbPath, render.thumbnail);

    const geometryOk =
      render.imageWidth === render.viewportWidth &&
      Math.abs(render.imageHeight - render.captureHeight) <= 1;

    console.log(`
  final URL       ${render.finalUrl}
  viewport        ${render.viewportWidth} x ${render.viewportHeight} CSS px
  document height ${render.documentHeight} CSS px${render.truncated ? "  (TRUNCATED — taller than the cap)" : ""}
  image           ${render.imageWidth} x ${render.imageHeight} px
  geometry        ${geometryOk ? "OK — image pixels are document CSS pixels" : "MISMATCH — overlays would not align"}
  rendered in     ${render.durationMs} ms
  size            ${(render.buffer.length / 1024).toFixed(0)} KB
  content hash    ${contentHash(render.html)?.slice(0, 16)}...
  perceptual hash ${await perceptualHash(render.buffer)}

  written  ${outPath}
           ${thumbPath}`);

    if (!geometryOk) {
      console.error("\n  The worker would REJECT this capture rather than store it.");
      process.exitCode = 2;
    }

    if (args.compare) {
      const previous = fs.readFileSync(path.resolve(args.compare));
      const diff = await imageDiff(previous, render.buffer);
      const threshold = Number(process.env.CAPTURE_DIFF_THRESHOLD_PCT ?? 1);
      console.log(`
  vs ${args.compare}
  changed         ${diff.changedPct.toFixed(2)}% of comparable pixels
  reflowed        ${diff.heightChanged ? "yes — page height differs" : "no"}
  changed areas   ${diff.changedBoxes.length}${diff.changedBoxes.length ? `  (largest at y=${diff.changedBoxes[0].y})` : ""}
  verdict         ${diff.changedPct < threshold ? "DISCARD — no visible change" : "STORE — new version"}`);
    }
  } catch (err) {
    console.error(`\n  Capture failed: ${err.message}`);
    if (err.code) console.error(`  reason: ${err.code}`);
    if (String(err.message).includes("Executable doesn't exist")) {
      console.error("\n  Chromium is not installed. Run:  npx playwright install chromium");
    }
    process.exitCode = 1;
  } finally {
    await pool.close();
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, "-");
  } catch {
    return "page";
  }
}

main();
