// Captures the live website (https://tlauom.com) for the organisation profile:
//   profile/assets/banner.png          – the header banner (rendered from banner.html)
//   profile/assets/live-preview.gif    – laptop + phone scrolling through the home page
//   profile/assets/pages/<name>.jpg    – thumbnails of the main pages
//   profile/assets/events/<name>.jpg   – copies of the website's event pictures (/og/<name>.jpg)
// and stamps the capture date into profile/README.md.
//
// Run:  npm ci && npx playwright install chromium && npm run capture
// Locally on Windows you can skip the browser download with BROWSER_CHANNEL=msedge.

import { chromium, devices } from "playwright";
import gifenc from "gifenc";
import pngjs from "pngjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const { PNG } = pngjs;

const SITE = (process.env.SITE_URL || "https://tlauom.com").replace(/\/$/, "");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "profile", "assets");
const README = path.join(ROOT, "profile", "README.md");

// Pages shown in the "Explore the website" grid. The file name is used in README.md.
// Pages that list people by name (members, seniors) are left out on purpose:
// these pictures stay in the repository's history.
const PAGES = [
  { file: "books", path: "/books" },
  { file: "teams", path: "/teams" },
  { file: "history", path: "/history" },
  { file: "faq", path: "/faq" },
  { file: "contact", path: "/contact" },
  { file: "intro", path: "/intro" },
];

// Event pictures for the "What we do" grid. They are copied into this repository
// because GitHub's image proxy sometimes fails to fetch them from tlauom.com.
const EVENTS = [
  "thamilaruvi", "sotkanai", "brammam",
  "ideathon", "jeevanathi", "blood-donation",
  "vani-villa", "thaipongal", "aramiyam",
];

const FRAMES = 40;         // scrolling frames in the GIF
const FRAME_DELAY = 110;    // ms per scrolling frame
const HOLD_START = 2200;    // ms on the first frame
const HOLD_END = 1400;      // ms on the last frame

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function openSite(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await sleep(2500);
  return page;
}

// Scroll through once so lazy images and scroll effects have loaded.
async function warmUp(page) {
  const max = await maxScroll(page);
  for (let y = 0; y <= max; y += 500) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await sleep(180);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1500);
}

const maxScroll = (page) =>
  page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));

async function renderBanner(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 1.5 });
  await page.goto(pathToFileURL(path.join(ROOT, "scripts", "banner.html")).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  await page.screenshot({ path: path.join(ASSETS, "banner.png"), omitBackground: true });
  await page.close();
  console.log("✓ banner.png");
}

async function renderPreview(browser, stampText) {
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const { defaultBrowserType, ...iphone } = devices["iPhone 13"];
  // 390x810 matches the phone screen in showcase.html (236x490).
  const mobileCtx = await browser.newContext({ ...iphone, viewport: { width: 390, height: 810 }, deviceScaleFactor: 1 });

  const [desktop, mobile] = await Promise.all([openSite(desktopCtx, SITE + "/"), openSite(mobileCtx, SITE + "/")]);
  await Promise.all([warmUp(desktop), warmUp(mobile)]);
  const [dMax, mMax] = await Promise.all([maxScroll(desktop), maxScroll(mobile)]);

  const stage = await browser.newPage({ viewport: { width: 1200, height: 660 }, deviceScaleFactor: 1 });
  await stage.goto(pathToFileURL(path.join(ROOT, "scripts", "showcase.html")).href, { waitUntil: "networkidle" });
  await stage.evaluate((t) => { document.getElementById("stamp").textContent = t; }, stampText);

  const frames = [];
  let width = 0, height = 0;
  for (let i = 0; i < FRAMES; i++) {
    const t = ease(i / (FRAMES - 1));
    await Promise.all([
      desktop.evaluate((v) => window.scrollTo(0, v), Math.round(t * dMax)),
      mobile.evaluate((v) => window.scrollTo(0, v), Math.round(t * mMax)),
    ]);
    await sleep(i === 0 ? 400 : 260); // let the site's scroll effects settle
    const [d, m] = await Promise.all([
      desktop.screenshot({ type: "jpeg", quality: 88 }),
      mobile.screenshot({ type: "jpeg", quality: 88 }),
    ]);
    await stage.evaluate(async ([d64, m64]) => {
      const set = (id, b64) => {
        const img = document.getElementById(id);
        img.src = "data:image/jpeg;base64," + b64;
        return img.decode();
      };
      await Promise.all([set("desktop", d64), set("mobile", m64)]);
    }, [d.toString("base64"), m.toString("base64")]);

    const png = PNG.sync.read(await stage.screenshot({ type: "png" }));
    width = png.width; height = png.height;
    frames.push(png.data);
  }
  await Promise.all([desktopCtx.close(), mobileCtx.close(), stage.close()]);

  await writeFile(path.join(ASSETS, "live-preview.gif"), encodeGif(frames, width, height));
  console.log("✓ live-preview.gif");
}

// One shared palette for all frames, and pixels that did not change since the
// previous frame are left transparent. The frame around the screens never
// changes, so this keeps the GIF a fraction of the size.
function encodeGif(frames, width, height) {
  const sample = [];
  const step = Math.max(1, Math.floor(frames.length / 8));
  for (let f = 0; f < frames.length; f += step) {
    const d = frames[f];
    for (let p = 0; p < d.length; p += 4 * 3) sample.push(d[p], d[p + 1], d[p + 2], 255);
  }
  const palette = quantize(new Uint8Array(sample), 255);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const TRANSPARENT = 255;

  const gif = GIFEncoder();
  let prev = null;
  frames.forEach((data, i) => {
    const index = applyPalette(data, palette.slice(0, 255));
    const out = new Uint8Array(index);
    if (prev) for (let p = 0; p < out.length; p++) if (index[p] === prev[p]) out[p] = TRANSPARENT;
    const delay = i === 0 ? HOLD_START : i === frames.length - 1 ? HOLD_END : FRAME_DELAY;
    gif.writeFrame(out, width, height, {
      palette: i === 0 ? palette : undefined,
      delay,
      repeat: 0,
      transparent: i > 0,
      transparentIndex: TRANSPARENT,
      dispose: 1,
    });
    prev = index;
  });
  gif.finish();
  return gif.bytes();
}

async function renderPages(browser) {
  // Half-size thumbnails of a 1280x800 window.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5 });
  await mkdir(path.join(ASSETS, "pages"), { recursive: true });
  for (const p of PAGES) {
    const page = await openSite(ctx, SITE + p.path);
    await page.screenshot({ path: path.join(ASSETS, "pages", `${p.file}.jpg`), type: "jpeg", quality: 82 });
    await page.close();
    console.log(`✓ pages/${p.file}.jpg`);
  }
  await ctx.close();
}

async function copyEventPictures() {
  await mkdir(path.join(ASSETS, "events"), { recursive: true });
  for (const name of EVENTS) {
    try {
      const res = await fetch(`${SITE}/og/${name}.jpg`);
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("image/")) throw new Error(`${res.status} ${type}`);
      await writeFile(path.join(ASSETS, "events", `${name}.jpg`), Buffer.from(await res.arrayBuffer()));
      console.log(`✓ events/${name}.jpg`);
    } catch (err) {
      // Keep last week's copy rather than failing the whole refresh.
      console.warn(`! events/${name}.jpg not updated: ${err.message}`);
    }
  }
}

async function stampReadme(dateText) {
  const md = await readFile(README, "utf8");
  const next = md.replace(/(<!--captured-->)[\s\S]*?(<!--\/captured-->)/, `$1${dateText}$2`);
  if (next !== md) await writeFile(README, next);
}

const now = new Date();
const dateText = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" });

await mkdir(ASSETS, { recursive: true });
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
try {
  await renderBanner(browser);
  await renderPreview(browser, `CAPTURED ${dateText.toUpperCase()}`);
  await renderPages(browser);
  await copyEventPictures();
  await stampReadme(dateText);
} finally {
  await browser.close();
}
