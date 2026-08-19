import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const cubeStl = `solid cube
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 40 0 0
vertex 40 40 0
endloop
endfacet
facet normal 0 0 -1
outer loop
vertex 0 0 0
vertex 40 40 0
vertex 0 40 0
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 0 0 40
vertex 40 40 40
vertex 40 0 40
endloop
endfacet
facet normal 0 0 1
outer loop
vertex 0 0 40
vertex 0 40 40
vertex 40 40 40
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 0 0 40
vertex 40 0 40
endloop
endfacet
facet normal 0 -1 0
outer loop
vertex 0 0 0
vertex 40 0 40
vertex 40 0 0
endloop
endfacet
facet normal 1 0 0
outer loop
vertex 40 0 0
vertex 40 0 40
vertex 40 40 40
endloop
endfacet
facet normal 1 0 0
outer loop
vertex 40 0 0
vertex 40 40 40
vertex 40 40 0
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 40 40 0
vertex 40 40 40
vertex 0 40 40
endloop
endfacet
facet normal 0 1 0
outer loop
vertex 40 40 0
vertex 0 40 40
vertex 0 40 0
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 40 0
vertex 0 40 40
vertex 0 0 40
endloop
endfacet
facet normal -1 0 0
outer loop
vertex 0 40 0
vertex 0 0 40
vertex 0 0 0
endloop
endfacet
endsolid cube
`;

async function canvasStats(page) {
  return page.locator(".canvasFrame canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "no-webgl" };
    const width = canvas.width;
    const height = canvas.height;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let orange = 0;
    let variance = 0;
    let opaque = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a > 0) opaque += 1;
      if (r > 170 && g > 55 && g < 190 && b < 120) orange += 1;
      variance += Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
    }
    return {
      ok: opaque > width * height * 0.95 && variance > width * height * 8,
      width,
      height,
      orange,
      opaque,
      variance: Math.round(variance / (width * height)),
    };
  });
}

async function run() {
  const outputDir = path.resolve("work", "smoke");
  await fs.mkdir(outputDir, { recursive: true });

  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.locator(".canvasFrame canvas").waitFor({ state: "visible" });
  const emptyStats = await canvasStats(page);

  await page.setInputFiles('input[type="file"]', {
    name: "cube.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(cubeStl),
  });
  await page.getByText("cube.stl").waitFor({ timeout: 10_000 });
  await page.getByLabel("Rotate").click();
  await page.getByLabel("Move").click();
  await page.getByLabel("Auto arrange").click();
  await page.screenshot({ path: path.join(outputDir, "desktop.png"), fullPage: true });
  const modelStats = await canvasStats(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: path.join(outputDir, "mobile.png"), fullPage: true });
  const mobileStats = await canvasStats(page);
  await browser.close();

  const result = {
    emptyStats,
    modelStats,
    mobileStats,
    mobileOverflow,
    errors,
    screenshots: {
      desktop: path.join(outputDir, "desktop.png"),
      mobile: path.join(outputDir, "mobile.png"),
    },
  };
  console.log(JSON.stringify(result, null, 2));

  if (!emptyStats.ok || !modelStats.ok || modelStats.orange < 150 || !mobileStats.ok || mobileOverflow > 4 || errors.length) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
