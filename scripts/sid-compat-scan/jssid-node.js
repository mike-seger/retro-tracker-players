'use strict';

/**
 * jssid-node.js
 *
 * Adapts jsSID.js for headless Node.js execution.
 *
 * jsSID was written for the browser and depends on:
 *   - AudioContext / webkitAudioContext
 *   - ScriptProcessorNode
 *   - XMLHttpRequest
 *
 * We install minimal synchronous stubs for all three so that:
 *   1. The constructor builds the SID emulator and its waveform tables (expensive,
 *      done ONCE per worker via createPlayer()).
 *   2. loadBuffer() feeds a Node Buffer into the player by injecting it through
 *      the synchronous XHR stub — no network call, no event loop involvement.
 *   3. generateAndCheckRMS() drives the ScriptProcessor handler in a tight
 *      CPU loop and reports peak RMS, supporting early exit as soon as audio
 *      is detected.
 *
 * Usage (one player per worker thread):
 *   const { createPlayer, loadBuffer, generateAndCheckRMS } = require('./jssid-node');
 *   const player = createPlayer();                    // expensive; do once
 *   loadBuffer(player, fs.readFileSync(sidPath));     // cheap; resets state
 *   const { hasAudio } = generateAndCheckRMS(player, MAX_SAMPLES, 0.001);
 */

const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

const JSSID_PATH  = path.resolve(__dirname, '../../engines/jssid/jsSID.js');
const SAMPLE_RATE = 44100;
const BUF_LEN     = 8192; // must match the bufln passed to jsSID constructor

// ── Synchronous XHR shim ──────────────────────────────────────────────────
// loadBuffer() stores the ArrayBuffer here right before calling loadstart().
// The XHR stub's send() picks it up synchronously, so req.onload fires
// before loadstart() returns — the opposite of browser async behaviour, but
// the end state is identical.
let _pendingBuffer = null;

function AudioContextStub() {
  this.sampleRate  = SAMPLE_RATE;
  this.state       = 'running';
  this.destination = {};
  this.createScriptProcessor = (_buflen) => ({
    // jsSID assigns onaudioprocess after construction; we preserve the
    // reference so generateAndCheckRMS() can call it later.
    onaudioprocess: null,
    connect()    {},
    disconnect() {},
  });
  this.resume = () => Promise.resolve();
}

function XMLHttpRequestStub() {
  this.responseType = 'arraybuffer';
  this.open  = () => {};
  this.send  = () => {
    this.response = _pendingBuffer;
    if (this.onload) this.onload();
  };
}

// Install globals before loading jsSID.js.
// worker_threads each have their own V8 context so this is safe to do once
// per worker at module-load time.
global.AudioContext      = AudioContextStub;
global.webkitAudioContext = AudioContextStub;
global.XMLHttpRequest    = XMLHttpRequestStub;

// Load jsSID.js into the current V8 context.
// vm.runInThisContext makes `function jsSID(...)` a true global, exactly as
// it would be in a browser's window scope.
vm.runInThisContext(fs.readFileSync(JSSID_PATH, 'utf8'), { filename: JSSID_PATH });

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create one reusable jsSID player instance.
 * This is the expensive call — jsSID builds three 4096-entry waveform tables
 * (trsaw, pusaw, Pulsetrsaw) inside the constructor via cCmbWF().
 * Create once per worker thread and reuse across all files.
 *
 * @returns {object} jsSID player instance
 */
function createPlayer() {
  return new jsSID(BUF_LEN, 0 /* bgnoi = 0: no background noise */);
}

/**
 * Load a SID file from a Node.js Buffer into an existing player.
 * Fully synchronous thanks to the XHR stub.
 * Internally resets the 64 KB C64 memory, re-parses all header fields,
 * and runs the SID's init routine (up to 100 000 CPU cycles) — safe to
 * call repeatedly on the same player instance.
 *
 * @param {object} player  - jsSID instance returned by createPlayer()
 * @param {Buffer} buffer  - Raw SID file contents
 * @param {number} subtune - 0-indexed subtune to initialise (default 0)
 */
function loadBuffer(player, buffer, subtune = 0) {
  // Ensure we hand jsSID a proper ArrayBuffer (not a Node Buffer view).
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  _pendingBuffer = ab;
  player.loadstart('', subtune);
}

/**
 * Drive the jsSID ScriptProcessor in a tight CPU loop and report peak RMS.
 * Supports early exit: stops as soon as a chunk's RMS exceeds rmsThreshold.
 *
 * @param {object} player        - jsSID instance (already loaded via loadBuffer)
 * @param {number} maxSamples    - Total samples to generate before declaring silence
 *                                 (10 s at 44100 Hz = 441 000 samples)
 * @param {number} rmsThreshold  - RMS level considered "audio present" (engine.js uses 0.001)
 * @returns {{ hasAudio: boolean, peakRms: number, samplesProcessed: number }}
 */
function generateAndCheckRMS(player, maxSamples, rmsThreshold) {
  const node    = player.getAudioNode();
  const handler = node.onaudioprocess;
  if (!handler) return { hasAudio: false, peakRms: 0, samplesProcessed: 0 };

  // Reuse a single Float32Array across all chunks — jsSID writes into
  // oDat[0..length-1] where oDat = outputBuffer.getChannelData(0).
  const chunkBuf = new Float32Array(BUF_LEN);
  const fakeEvent = {
    outputBuffer: {
      getChannelData: () => chunkBuf,
      length: BUF_LEN,
    },
  };

  let samplesProcessed = 0;
  let peakRms = 0;

  while (samplesProcessed < maxSamples) {
    handler(fakeEvent);

    // Compute RMS of generated chunk.
    let sum = 0;
    for (let i = 0; i < BUF_LEN; i++) sum += chunkBuf[i] * chunkBuf[i];
    const rms = Math.sqrt(sum / BUF_LEN);
    if (rms > peakRms) peakRms = rms;

    samplesProcessed += BUF_LEN;
    if (peakRms >= rmsThreshold) break; // audio detected — no need to go further
  }

  return { hasAudio: peakRms >= rmsThreshold, peakRms, samplesProcessed };
}

module.exports = { createPlayer, loadBuffer, generateAndCheckRMS, SAMPLE_RATE, BUF_LEN };
