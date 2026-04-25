'use strict';

/**
 * worker.js — worker_threads worker for the SID compatibility scanner.
 *
 * Each worker:
 *  1. Creates ONE jsSID player at startup (expensive waveform tables, done once).
 *  2. Receives batches of file paths via parentPort.
 *  3. For each path: reads file, computes MD5, parses header, synthesises up to
 *     SEEK_SAMPLES of audio, checks RMS.
 *  4. Posts results back as an array of row objects.
 *
 * Message protocol (parent → worker):
 *   { paths: string[] }
 *
 * Message protocol (worker → parent):
 *   { results: Row[] }
 *
 * Row shape:
 *   {
 *     path            : string
 *     md5             : string   // hex, or '' on read error
 *     jsSID_compatible: boolean
 *     decodes_audio   : boolean
 *     reason          : string   // '' on full success, diagnostic otherwise
 *   }
 */

const { parentPort } = require('worker_threads');
const crypto = require('crypto');
const fs     = require('fs');

const { createPlayer, loadBuffer, generateAndCheckRMS, SAMPLE_RATE } = require('./jssid-node');
const { parseSIDHeader } = require('./sid-header');

// 10 s × 44100 Hz.  Matches updated seek recommendation.
const SEEK_SAMPLES  = 10 * SAMPLE_RATE; // 441 000
const RMS_THRESHOLD = 0.001;            // mirrors engine.js silence check

// Create the player ONCE for this worker.  jsSID builds three 4096-entry waveform
// tables in the constructor — this is the dominant startup cost (~50–100 ms).
const player = createPlayer();

parentPort.on('message', ({ paths }) => {
  const results = [];

  for (const filePath of paths) {
    /** @type {Row} */
    const row = {
      path: filePath,
      md5: '',
      jsSID_compatible: false,
      decodes_audio: false,
      reason: '',
    };

    // ── Step 1: read file ────────────────────────────────────────────────
    let buf;
    try {
      buf = fs.readFileSync(filePath);
    } catch (err) {
      row.reason = `read_error:${err.code || err.message}`;
      results.push(row);
      continue;
    }

    // ── Step 2: MD5 ──────────────────────────────────────────────────────
    row.md5 = crypto.createHash('md5').update(buf).digest('hex');

    // ── Step 3: header parse ─────────────────────────────────────────────
    const hdr = parseSIDHeader(buf);
    row.jsSID_compatible = hdr.jsSID_compatible;
    if (!hdr.valid) {
      row.reason = hdr.reason;
      results.push(row);
      continue;
    }
    // Carry any soft reason (e.g. rsid_uncertain) forward; may be overwritten.
    if (hdr.reason) row.reason = hdr.reason;

    // ── Step 4: decode check ─────────────────────────────────────────────
    try {
      loadBuffer(player, buf, 0);
      const { hasAudio } = generateAndCheckRMS(player, SEEK_SAMPLES, RMS_THRESHOLD);
      row.decodes_audio = hasAudio;
      if (!hasAudio && !row.reason) row.reason = 'silent';
    } catch (err) {
      row.reason = `decode_error:${err.message}`;
    }

    results.push(row);
  }

  parentPort.postMessage({ results });
});
