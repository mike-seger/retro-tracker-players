// jsSID engine adapter
const BASE = 'engines/jssid/';
let player = null;
let _onEnd = null;
let _compressor = null;
let _analyser = null;
let _connected = false;
let _silenceTimer = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function init() {
  await loadScript(BASE + 'jsSID.js');
  player = new jsSID(8192, 0.0004);
  player.setendcallback(() => { _onEnd?.(); });

  // Insert compressor between ScriptProcessorNode and destination
  const ctx = player.getAudioContext();
  const node = player.getAudioNode();
  if (ctx && node) {
    _compressor = ctx.createDynamicsCompressor();
    _compressor.threshold.value = -20;
    _compressor.knee.value = 12;
    _compressor.ratio.value = 8;
    _compressor.attack.value = 0.003;
    _compressor.release.value = 0.15;
    _analyser = ctx.createAnalyser();
    _analyser.fftSize = 256;
    _analyser.connect(_compressor);
    _compressor.connect(ctx.destination);
    // Preserve original behavior and only add routing through analyser → compressor.
    const origPlay = player.playcont.bind(player);
    const origPause = player.pause.bind(player);
    player.playcont = () => {
      if (!_connected) {
        node.connect(_analyser);
        _connected = true;
      }
      origPlay();
    };
    player.pause = () => {
      clearTimeout(_silenceTimer);
      _silenceTimer = null;
      try { origPause(); } catch (_) {}
      if (_connected) {
        try { node.disconnect(_analyser); } catch (_) {}
        _connected = false;
      }
    };
  }
}

async function resumeContext() {
  try {
    const ctx = player?.getAudioContext?.();
    if (ctx?.state === 'suspended') await ctx.resume();
  } catch (_) {}
}

export async function load(url) {
  await resumeContext();
  return new Promise((resolve) => {
    player.setloadcallback(() => {
      player.setmodel(player.getprefmodel());
      player.playcont();
      // Auto-advance if jsSID produces no audio (unsupported RSID files)
      clearTimeout(_silenceTimer);
      _silenceTimer = setTimeout(() => {
        _silenceTimer = null;
        if (!_analyser) return;
        const buf = new Float32Array(_analyser.fftSize);
        _analyser.getFloatTimeDomainData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
        if (rms < 0.001) _onEnd?.();
      }, 3500);
      resolve({
        fields: [
          { label: 'Engine',   value: 'jsSID' },
          { label: 'Title',    value: player.gettitle().replace(/\0/g, '') },
          { label: 'Author',   value: player.getauthor().replace(/\0/g, '') },
          { label: 'Released', value: player.getinfo().replace(/\0/g, '') },
          { label: 'Model',    value: String(player.getprefmodel()) },
          { label: 'Subtune',  value: '1 / ' + player.getsubtunes() },
        ],
        duration: 300,
      });
    });
    player.loadstart(url, 0);
  });
}

export function pause()  { if (player) player.pause(); }
export async function resume() { if (player) { await resumeContext(); player.playcont(); } }
export function seekTo(s) { if (player) player.seekTo(s); }
export function getTime() { return player ? player.getplaytime() : 0; }
export function setVolume(v) { if (player) player.setvolume(v); }
export function isEnded() { return false; }
export function onEnd(cb) { _onEnd = cb; }
export function destroy() { if (player) player.pause(); }
