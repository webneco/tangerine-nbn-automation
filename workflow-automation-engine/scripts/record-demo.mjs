#!/usr/bin/env node
/**
 * Record a screen demo of the Tangerine journey:
 *   ffmpeg (gdigrab) → headed Playwright run → HTML report on screen → graceful stop.
 *
 * Env:
 *   FFMPEG_PATH     ffmpeg binary to use (default: ffmpeg-static). Needs the gdigrab device.
 *   RECORD_REGION   "WIDTHxHEIGHT" from the top-left of the PRIMARY monitor (gdigrab offsets are
 *                   relative to it). Default 1920x1080; "full" captures the whole virtual desktop.
 *   REPORT_SECONDS  how long to keep recording the report (default 12).
 * Any other env (JOB_PAYLOAD, UNIQUE_EMAIL, …) is passed through to the test.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REC_DIR = path.join(ROOT, 'recordings');
const RESULTS_DIR = path.join(ROOT, 'test-results');
const CSV = path.join(ROOT, 'run-logs', 'emails-used.csv');
const REPORT_SECONDS = Number(process.env.REPORT_SECONDS || 12);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => console.log(`[demo] ${msg}`);
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

// ---------- ffmpeg ----------
function resolveFfmpeg() {
  const candidates = [process.env.FFMPEG_PATH, (() => { try { return require('ffmpeg-static'); } catch { return null; } })()].filter(Boolean);
  for (const bin of candidates) {
    if (!fs.existsSync(bin)) continue;
    const devices = spawnSync(bin, ['-hide_banner', '-devices'], { encoding: 'utf8' });
    if (`${devices.stdout}${devices.stderr}`.includes('gdigrab')) return bin;
    say(`${bin} has no gdigrab device — skipping`);
  }
  throw new Error(
    'No ffmpeg with gdigrab found. Install one (winget install Gyan.FFmpeg) and set FFMPEG_PATH to its ffmpeg.exe ' +
      '(if ffmpeg-static is installed but its binary is missing, run: npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static).',
  );
}

/** Stop the whole process tree (shell:true children are wrapped in cmd.exe on Windows). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

const exited = (child) => new Promise((resolve) => (child.exitCode !== null ? resolve(child.exitCode) : child.once('exit', (code) => resolve(code))));

let ffmpeg = null;
let ffmpegStopping = null;

/** Graceful stop: "q" on stdin lets ffmpeg write the MP4 trailer. A hard kill corrupts the file. */
function stopFfmpeg() {
  if (!ffmpeg) return Promise.resolve();
  if (ffmpegStopping) return ffmpegStopping;
  ffmpegStopping = (async () => {
    if (ffmpeg.exitCode === null) {
      say('Stopping recording …');
      try {
        ffmpeg.stdin.write('q');
        ffmpeg.stdin.end();
      } catch {
        /* already closing (e.g. it got the Ctrl+C too) */
      }
      const code = await Promise.race([exited(ffmpeg), sleep(30_000).then(() => 'timeout')]);
      if (code === 'timeout') {
        say('ffmpeg did not exit within 30 s — killing it (the MP4 may be incomplete)');
        ffmpeg.kill('SIGKILL');
      }
    }
  })();
  return ffmpegStopping;
}

// ---------- outputs ----------
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map((p) => path.join(dir, String(p)));
}

function copyArtifacts() {
  const copied = [];
  for (const file of walk(RESULTS_DIR)) {
    const base = path.basename(file);
    let target = null;
    if (base === 'video.webm') {
      target = `tangerine-demo-${stamp}-${path.basename(path.dirname(file))}.webm`;
    } else if (path.dirname(file) === RESULTS_DIR && base.endsWith('.png')) {
      target = base; // the <txnId>.png screenshot
    }
    if (!target) continue;
    fs.copyFileSync(file, path.join(REC_DIR, target));
    copied.push(target);
  }
  return copied;
}

function lastCsvRow() {
  if (!fs.existsSync(CSV)) return '(no run-logs/emails-used.csv)';
  const rows = fs.readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  return rows.length > 1 ? `${rows[0]}\n${rows[rows.length - 1]}` : '(no rows yet)';
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ---------- main ----------
let interrupted = false;
let testChild = null;
let reportChild = null;
let reportBrowser = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* server not up yet */
    }
    await sleep(300);
  }
  throw new Error(`${url} did not respond within ${timeoutMs} ms`);
}

/**
 * Serve the report with `playwright show-report` WITHOUT its auto-open, then show it in our own
 * Chromium window at 0,0 (same spot as the test browser) so it is guaranteed to be on screen.
 * show-report has no --no-open flag; it skips opening when it thinks a coding agent runs it,
 * so CLAUDECODE=1 is set for that child process only.
 */
async function showReportOnScreen() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  say(`Serving the HTML report at ${url} (no auto-open)`);
  reportChild = spawn(`npx playwright show-report --host 127.0.0.1 --port ${port}`, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CLAUDECODE: '1' },
  });
  await waitForHttp(url, 20_000);

  const { chromium } = require('@playwright/test');
  reportBrowser = await chromium.launch({ headless: false, args: ['--window-position=0,0', '--window-size=1366,900'] });
  const page = await reportBrowser.newPage({ viewport: null });
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  say(`Showing the HTML report for ${REPORT_SECONDS} s`);
  await sleep(REPORT_SECONDS * 1_000);
}

process.on('SIGINT', async () => {
  if (interrupted) return;
  interrupted = true;
  say('Ctrl+C — saving the partial recording …');
  await reportBrowser?.close().catch(() => {});
  killTree(reportChild);
  await stopFfmpeg();
  killTree(testChild);
  process.exit(130);
});

async function main() {
  fs.mkdirSync(REC_DIR, { recursive: true });
  const bin = resolveFfmpeg();
  const out = path.join(REC_DIR, `tangerine-demo-${stamp}.mp4`);

  const rawRegion = (process.env.RECORD_REGION ?? '1920x1080').trim().toLowerCase();
  const region = rawRegion === 'full' || rawRegion === '' ? null : rawRegion;
  if (region && !/^\d+x\d+$/.test(region)) throw new Error(`RECORD_REGION must look like 1920x1080 or "full", got "${rawRegion}"`);
  const args = [
    '-y',
    '-loglevel', 'error',
    '-f', 'gdigrab',
    '-framerate', '30',
    '-draw_mouse', '1',
    ...(region ? ['-offset_x', '0', '-offset_y', '0', '-video_size', region] : []),
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    out,
  ];
  say(`Recording ${region ? `region ${region}` : 'desktop'} → ${out}`);
  ffmpeg = spawn(bin, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  ffmpeg.stdin.on('error', () => {});
  ffmpeg.once('exit', (code) => {
    if (!ffmpegStopping && !interrupted) say(`ffmpeg exited early (code ${code})`);
  });

  await sleep(2_000);
  if (ffmpeg.exitCode !== null) throw new Error(`ffmpeg failed to start (exit ${ffmpeg.exitCode})`);

  say('Running: npx playwright test --grep @TangerineModule --headed');
  testChild = spawn('npx playwright test --grep @TangerineModule --headed', { cwd: ROOT, stdio: 'inherit', shell: true });
  const testCode = (await exited(testChild)) ?? 1;
  testChild = null;
  say(`Playwright exited with code ${testCode}`);

  if (!interrupted) {
    try {
      await showReportOnScreen();
    } catch (e) {
      say(`Could not show the report: ${e.message}`);
    } finally {
      await reportBrowser?.close().catch(() => {});
      reportBrowser = null;
      killTree(reportChild);
      reportChild = null;
    }
  }

  await stopFfmpeg();

  const copied = copyArtifacts();
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  console.log('');
  say(`MP4:        ${out}`);
  say(`Size:       ${mb(size)}${size === 0 ? '  ⚠ empty file' : ''}`);
  say(`Test exit:  ${testCode}`);
  say(`Copied:     ${copied.length ? copied.join(', ') : '(nothing in test-results)'}`);
  say(`Latest emails-used.csv row:\n${lastCsvRow()}`);
  process.exit(testCode);
}

main().catch(async (e) => {
  console.error(`[demo] ${e.message}`);
  killTree(reportChild);
  killTree(testChild);
  await stopFfmpeg();
  process.exit(1);
});
