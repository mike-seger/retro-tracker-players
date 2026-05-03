// AHX engine adapter
const BASE = 'engines/ahx/';
let master = null;
let song = null;
let _onEnd = null;
let _loadGen = 0;
let _aborted = false;
let gainNode = null;
let compressor = null;
let volume = 1;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function init() {
  await loadScript(BASE + 'ahx.js');
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

function parseMetaFromEntry(entry) {
  if (!entry?.name) return null;
  const decoded = decodeSafe(String(entry.name));
  const slash = decoded.lastIndexOf('/');
  const fileName = slash >= 0 ? decoded.substring(slash + 1) : decoded;
  const folder = slash >= 0 ? decoded.substring(0, slash) : '';
  const enDash = fileName.indexOf(' \u2013 ');
  const hyphen = fileName.indexOf(' - ');
  const dashIdx = enDash >= 0 ? enDash : hyphen;
  if (dashIdx >= 0) {
    return {
      artist: fileName.substring(0, dashIdx).trim().replace(/_/g, ' '),
      title: fileName.substring(dashIdx + 3).replace(/\.\w+$/i, '').trim().replace(/_/g, ' '),
    };
  }
  return {
    artist: folder.trim().replace(/_/g, ' '),
    title: fileName.replace(/\.\w+$/i, '').trim().replace(/_/g, ' '),
  };
}

function parseArtistFromUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return decodeSafe(parts[parts.length - 2]);
  } catch (_) {
    const parts = String(url).split('/');
    if (parts.length >= 2) return decodeSafe(parts[parts.length - 2]);
  }
  return '';
}

export async function load(url, entry = null) {
  const gen = ++_loadGen;
  _aborted = false;
  if (!master) master = AHXMaster();

  // Stop current
  if (master.AudioNode) {
    try { master.Stop(); } catch (_) {}
  }

  song = new AHXSong();
  return new Promise((resolve) => {
    song.LoadSong(url, () => {
      if (gen !== _loadGen) { pause(); resolve({ fields: [], duration: 0 }); return; }
      if (_aborted) { pause(); resolve({ fields: [], duration: 0 }); return; }
      const mult = song.SpeedMultiplier || 1;
      const estSeconds = Math.ceil(song.PositionNr * song.TrackLength * 6 / (50 * mult));

      master.Play(song);
      connectAudio();

      const parsed = parseMetaFromEntry(entry);
      const artist = parsed?.artist || parseArtistFromUrl(url) || '—';
      const title = parsed?.title || song.Name || '—';

      resolve({
        fields: [
          { label: 'Title',     value: title },
          { label: 'Artist',    value: artist },
          { label: 'Positions', value: song.PositionNr + ' positions, ' + song.TrackLength + ' steps' },
        ],
        duration: estSeconds,
      });
    });
  });
}

export function pause() {
  _aborted = true;
  if (master?.AudioNode) {
    try { master.AudioNode.disconnect(); } catch (_) {}
  }
}

export function resume() {
  connectAudio();
}

export function seekTo(s) {
  if (!master || !song) return;
  const mult = song.SpeedMultiplier || 1;
  const player = master.Output?.Player;
  if (!player) return;
  player.InitSong(song);
  player.InitSubsong(0);
  const ticksNeeded = Math.floor(s * 50 * mult);
  for (let i = 0; i < ticksNeeded; i++) {
    master.Output.MixBuffer();
    if (player.SongEndReached) break;
  }
  player.PlayingTime = ticksNeeded;
}

export function getTime() {
  if (!master || !song) return 0;
  const mult = song.SpeedMultiplier || 1;
  const player = master.Output?.Player;
  return player ? Math.floor(player.PlayingTime / (50 * mult)) : 0;
}

export function setVolume(v) {
  volume = v;
  if (gainNode) gainNode.gain.value = v;
}

export function isEnded() {
  const player = master?.Output?.Player;
  return player ? !!player.SongEndReached : false;
}

export function onEnd(cb) { _onEnd = cb; }

export function destroy() {
  if (master?.AudioNode) {
    try { master.AudioNode.disconnect(); } catch (_) {}
  }
}

function ensureGain() {
  if (!master?.AudioContext) return null;
  if (!gainNode) {
    gainNode = master.AudioContext.createGain();
    gainNode.gain.value = volume;
  }
  if (!compressor) {
    compressor = master.AudioContext.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
  }
  return gainNode;
}

function connectAudio() {
  if (!master?.AudioNode || !master?.AudioContext) return;
  const gain = ensureGain();
  if (!gain) return;
  try { master.AudioNode.disconnect(); } catch (_) {}
  try { gain.disconnect(); } catch (_) {}
  try { compressor.disconnect(); } catch (_) {}
  master.AudioNode.connect(gain);
  gain.connect(compressor);
  compressor.connect(master.AudioContext.destination);
}
