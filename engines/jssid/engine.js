// jsSID engine adapter
const BASE = 'engines/jssid/';
let player = null;
let _onEnd = null;
let _compressor = null;

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
    _compressor.connect(ctx.destination);
    // Override playcont/pause to route through compressor
    const origPlay = player.playcont.bind(player);
    const origPause = player.pause.bind(player);
    player.playcont = () => { node.connect(_compressor); };
    player.pause = () => { try { node.disconnect(_compressor); } catch (_) {} };
  }
}

export async function load(url) {
  return new Promise((resolve) => {
    player.setloadcallback(() => {
      resolve({
        fields: [
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
export function resume() { if (player) player.playcont(); }
export function seekTo(s) { if (player) player.seekTo(s); }
export function getTime() { return player ? player.getplaytime() : 0; }
export function setVolume(v) { if (player) player.setvolume(v); }
export function isEnded() { return false; }
export function onEnd(cb) { _onEnd = cb; }
export function destroy() { if (player) player.pause(); }
