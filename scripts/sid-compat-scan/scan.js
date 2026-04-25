#!/usr/bin/env node
'use strict';

/**
 * scan.js — main entry point for the offline SID compatibility scanner.
 *
 * Usage:
 *   node scan.js [options]
 *
 * Options:
 *   --input  <file>   Path list, one SID path per line  (default: ../../tmp/sid-test.txt)
 *   --output <file>   TSV output file                   (default: ../../tmp/sid-test.tsv)
 *   --workers <n>     Worker thread count               (default: CPU count, max 32)
 *   --batch <n>       Files per batch per worker        (default: 200)
 *   --resume          Skip rows already written to output (based on path column)
 *
 * TSV columns (tab-separated, no quoting):
 *   path  md5  jsSID_compatible  decodes_audio  reason
 *
 * Design:
 *   - Streams the input path list line by line — no full RAM load.
 *   - Maintains a fixed-size worker pool; each worker processes one batch at a time.
 *   - Writes rows to the output file as soon as each batch completes (streaming).
 *   - Periodic progress report to stderr every PROGRESS_INTERVAL completed files.
 *   - On Ctrl-C the output file is flushed and closed cleanly.
 */

const os      = require('os');
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');
const { Worker } = require('worker_threads');

// ── CLI argument parsing ─────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../..');

const args = parseArgs(process.argv.slice(2));
const INPUT_FILE  = args.input   || path.join(REPO_ROOT, 'tmp/sid-test.txt');
const OUTPUT_FILE = args.output  || path.join(REPO_ROOT, 'tmp/sid-test.tsv');
const NUM_WORKERS = Math.min(parseInt(args.workers || os.cpus().length, 10), 32);
const BATCH_SIZE  = parseInt(args.batch || '200', 10);
const RESUME      = !!args.resume;
const WORKER_PATH = path.join(__dirname, 'worker.js');
const PROGRESS_INTERVAL = 1000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

// ── Resume support ───────────────────────────────────────────────────────────
// Read already-processed paths from an existing output file so we can skip them.

function loadDonePaths(outputFile) {
  const done = new Set();
  if (!fs.existsSync(outputFile)) return done;
  const content = fs.readFileSync(outputFile, 'utf8');
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('path\t')) continue; // skip header
    const tab = line.indexOf('\t');
    if (tab > 0) done.add(line.slice(0, tab));
  }
  return done;
}

// ── Worker pool ───────────────────────────────────────────────────────────────

function createWorker(onResult) {
  const w = new Worker(WORKER_PATH);
  w.on('message', ({ results }) => onResult(results, w));
  w.on('error',   (err) => {
    process.stderr.write(`[worker error] ${err.message}\n`);
    // Replace the crashed worker with a fresh one so the pool stays full.
    onResult([], w);
  });
  return w;
}

// ── TSV helpers ───────────────────────────────────────────────────────────────

const TSV_HEADER = 'path\tmd5\tjsSID_compatible\tdecodes_audio\treason\n';

function rowToTsv(row) {
  // Tab characters in paths/reasons are replaced with spaces to preserve column count.
  const clean = (s) => String(s).replace(/\t/g, ' ').replace(/\n/g, ' ');
  return [
    clean(row.path),
    clean(row.md5),
    row.jsSID_compatible ? '1' : '0',
    row.decodes_audio    ? '1' : '0',
    clean(row.reason),
  ].join('\t') + '\n';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Validate input
  if (!fs.existsSync(INPUT_FILE)) {
    process.stderr.write(`Error: input file not found: ${INPUT_FILE}\n`);
    process.exit(1);
  }

  const donePaths = RESUME ? loadDonePaths(OUTPUT_FILE) : new Set();
  const isResume  = RESUME && donePaths.size > 0;

  // Open output — append if resuming, otherwise overwrite.
  const outStream = fs.createWriteStream(OUTPUT_FILE, { flags: isResume ? 'a' : 'w' });
  if (!isResume) outStream.write(TSV_HEADER);

  process.stderr.write(`SID scanner — ${NUM_WORKERS} workers, batch ${BATCH_SIZE}\n`);
  process.stderr.write(`Input : ${INPUT_FILE}\n`);
  process.stderr.write(`Output: ${OUTPUT_FILE}\n`);
  if (isResume) process.stderr.write(`Resume: skipping ${donePaths.size} already-processed paths\n`);

  const startTime = Date.now();
  let totalQueued    = 0;
  let totalCompleted = 0;
  let totalAudio     = 0;
  let totalCompatible = 0;
  let inputDone      = false;

  // Queue of pending batches not yet assigned to a worker.
  const pendingBatches = [];
  // Workers that are currently idle.
  const idleWorkers = [];

  function dispatchNext(worker) {
    if (pendingBatches.length > 0) {
      const batch = pendingBatches.shift();
      worker.postMessage({ paths: batch });
    } else {
      idleWorkers.push(worker);
      if (inputDone && idleWorkers.length === NUM_WORKERS) {
        finish();
      }
    }
  }

  function onResult(results, worker) {
    for (const row of results) {
      outStream.write(rowToTsv(row));
      totalCompleted++;
      if (row.jsSID_compatible) totalCompatible++;
      if (row.decodes_audio)    totalAudio++;
      if (totalCompleted % PROGRESS_INTERVAL === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate    = (totalCompleted / ((Date.now() - startTime) / 1000)).toFixed(0);
        process.stderr.write(
          `[${elapsed}s] ${totalCompleted}/${totalQueued} done — ${rate} files/s — ` +
          `compatible: ${totalCompatible}, audio: ${totalAudio}\n`
        );
      }
    }
    dispatchNext(worker);
  }

  // Spin up workers — all idle at start.
  for (let i = 0; i < NUM_WORKERS; i++) {
    idleWorkers.push(createWorker(onResult));
  }

  // Stream the path list and fill batches.
  let currentBatch = [];

  function enqueueBatch(forced = false) {
    if (currentBatch.length === 0) return;
    if (!forced && currentBatch.length < BATCH_SIZE) return;
    const batch = currentBatch.splice(0, BATCH_SIZE);
    pendingBatches.push(batch);
    // Assign immediately if a worker is idle.
    if (idleWorkers.length > 0) {
      const worker = idleWorkers.pop();
      const toDispatch = pendingBatches.shift();
      worker.postMessage({ paths: toDispatch });
    }
  }

  const rl = readline.createInterface({ input: fs.createReadStream(INPUT_FILE), crlfDelay: Infinity });

  await new Promise((resolve) => {
    rl.on('line', (line) => {
      const p = line.trim();
      if (!p || donePaths.has(p)) return;
      currentBatch.push(p);
      totalQueued++;
      if (currentBatch.length >= BATCH_SIZE) enqueueBatch();
    });
    rl.on('close', () => {
      // Flush any remaining partial batch.
      if (currentBatch.length > 0) {
        pendingBatches.push(currentBatch.splice(0));
        if (idleWorkers.length > 0) {
          const worker = idleWorkers.pop();
          const toDispatch = pendingBatches.shift();
          worker.postMessage({ paths: toDispatch });
        }
      }
      inputDone = true;
      if (totalQueued === 0) {
        resolve();
        finish();
        return;
      }
      if (idleWorkers.length === NUM_WORKERS) {
        resolve();
        finish();
      } else {
        // finish() will be called from onResult when last workers become idle.
        resolve();
      }
    });
  });

  // Keep process alive until finish() is called.
  await new Promise((resolve) => { _finishResolve = resolve; });

  function finish() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate    = totalCompleted > 0
      ? (totalCompleted / ((Date.now() - startTime) / 1000)).toFixed(0)
      : '0';
    process.stderr.write(
      `\nDone: ${totalCompleted} files in ${elapsed}s (${rate} files/s)\n` +
      `  jsSID_compatible: ${totalCompatible}  decodes_audio: ${totalAudio}\n` +
      `  Output: ${OUTPUT_FILE}\n`
    );
    outStream.end();
    for (const w of [...idleWorkers]) w.terminate();
    if (_finishResolve) _finishResolve();
  }
}

let _finishResolve = null;

// Clean shutdown on Ctrl-C.
process.on('SIGINT', () => {
  process.stderr.write('\nInterrupted — output flushed.\n');
  process.exit(0);
});

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
