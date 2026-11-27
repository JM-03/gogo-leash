// vidrec record.mjs — real screen recording via a screenshot loop.
// Headless screencast starves on static pages (5 frames in 34s), so we
// capture a JPEG every 100ms while the actions run, then encode at 30fps.
// Usage: node record.mjs <clip>  (console | terminal | lab | close)
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const CHROME = "/home/hatch/workspace/shot-chrome/chrome-linux64/chrome";
const OUT = "/tmp/vidrec/frames";
const FPS = 30;
const SHOT_MS = 100; // 10 fps capture

const CLIPS = {
  console: { url: "http://localhost:8787/", seconds: 14 },
  terminal: { url: "http://localhost:8934/terminal.html", seconds: 26 },
  lab: { url: "http://localhost:8933/", seconds: 34 },
  close: { url: "http://localhost:8934/close.html", seconds: 6 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordClip(browser, name, { url, seconds }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  execSync(`rm -f ${dir}/*.jpg`);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  // console: let the live vault data load BEFORE the first frame, so the
  // clip never opens on the "Loading..." state. (Do NOT wait for "QOR":
  // the page subtitle already contains it before any data loads.)
  if (name === "console") {
    await page.waitForFunction(
      () => !document.body.innerText.includes("Loading..."),
      { timeout: 15000 }
    ).catch(() => {});
  }

  // screenshot loop runs alongside the actions
  const frames = [];
  let shooting = true;
  const shooter = (async () => {
    while (shooting) {
      try {
        frames.push(await page.screenshot({ type: "jpeg", quality: 72 }));
      } catch {}
      await sleep(SHOT_MS);
    }
  })();

  const t0 = Date.now();
  const remaining = () => seconds * 1000 - (Date.now() - t0);

  if (name === "console") {
    await sleep(4000);
    await page.mouse.move(640, 360, { steps: 12 });
    await sleep(1500);
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "smooth" }));
    await sleep(3000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  if (name === "terminal") {
    await page.waitForFunction(() => window.__done === true, { timeout: 60000 }).catch(() => {});
  }

  if (name === "lab") {
    await page.waitForFunction(
      () => !document.getElementById("vault")?.innerText.includes("Loading"),
      { timeout: 30000 }
    ).catch(() => {});
    await sleep(1500);
    const steps = [
      ["attack-1", "#result", "BLOCKED"],
      ["attack-2", "#result", "BLOCKED"],
      ["attack-3", "#result", "BLOCKED"],
      ["verify-sig", "#verify-sig-result", "VERIFIED"],
      ["verify-pay", "#verify-pay-result", "PAID"],
    ];
    for (const [btn, box, word] of steps) {
      const el = await page.$(`#${btn}`);
      if (!el) continue;
      await el.scrollIntoView();
      await sleep(500);
      const b = await el.boundingBox();
      if (b) {
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
        await sleep(300);
        // visible click cue (headless screenshots hide the cursor)
        await el.evaluate((n) => { n.style.outline = "3px solid #fff"; n.style.outlineOffset = "2px"; });
        await sleep(350);
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      }
      await page.waitForFunction(
        (box, word) => document.querySelector(box)?.innerText.includes(word),
        { timeout: 30000 },
        box, word
      ).catch(() => {});
      await el.evaluate((n) => { n.style.outline = ""; });
      await page.evaluate((box) => {
        document.querySelector(box)?.scrollIntoView({ block: "nearest" });
      }, box);
      await sleep(2500);
    }
  }

  if (remaining() > 0) await sleep(remaining());
  shooting = false;
  await shooter;
  await page.close();

  // encode at 30fps: each 10fps frame shown 3x; pad with last frame if short
  const target = seconds * FPS;
  const per = FPS / (1000 / SHOT_MS); // 3
  let out = [];
  for (const f of frames) for (let k = 0; k < per; k++) out.push(f);
  if (out.length === 0) out = [await page.screenshot({ type: "jpeg", quality: 72 }).catch(() => null)].filter(Boolean);
  while (out.length < target) out.push(out[out.length - 1]);
  out = out.slice(0, target);
  out.forEach((buf, i) => writeFileSync(`${dir}/${String(i + 1).padStart(4, "0")}.jpg`, buf));
  console.log(`${name}: ${frames.length} shots -> ${out.length} frames (${seconds}s @ ${FPS}fps)`);
}

const clip = process.argv[2];
if (!CLIPS[clip]) {
  console.log("usage: node record.mjs <console|terminal|lab|close>");
  process.exit(1);
}
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-device-scale-factor=1"],
});
try {
  await recordClip(browser, clip, CLIPS[clip]);
} finally {
  await browser.close();
}
console.log("done", clip);
