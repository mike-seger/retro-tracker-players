// js/utils.js — Pure utility helpers + debug log output
import { debugLog } from './state.js';

export function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

export function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function trimDisplayPath(path) {
  if (!path || !path.includes('/')) return path;
  const parts = path.split('/').filter(Boolean);
  const letterIdx = parts.findIndex(part => part.length === 1);
  if (letterIdx >= 0 && letterIdx < parts.length - 1) {
    return parts.slice(letterIdx + 1).join('/');
  }
  return path;
}

export function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.substring(dot + 1).toUpperCase() : '';
}

export function toAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch (_) {
    return url;
  }
}

// Build a file URL for a local entry (relative to page root, used in fetch())
export function trackUrl(entry) {
  return entry.url
    ? entry.url
    : `engines/${entry.playerId}/files/${entry.name.split('/').map(encodeURIComponent).join('/')}`;
}

export const isMobile =
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

// Parse a track entry into display parts for 2-line row rendering.
// Returns { artist, title, folder } where:
//   artist — left slot of line 1 (normalised; never empty — falls back to "unknown")
//   folder — right slot of line 1 badge ("<root>" when entry has no path prefix)
//   title  — main content of line 2 (filename without extension)
export function parseTrackDisplay(entry) {
  const decoded = decodeURIComponent(entry.name);
  const slash = decoded.lastIndexOf('/');
  const rawFolder = slash >= 0 ? decoded.substring(0, slash) : '';
  const folder = rawFolder ? (trimDisplayPath(rawFolder) || rawFolder) : '';
  const baseName = slash >= 0 ? decoded.substring(slash + 1) : decoded;

  // Normalise artist: empty or "- unknown" variants → "unknown"
  const normArtist = s => {
    const t = s.trim();
    return (!t || /^-?\s*unknown$/i.test(t)) ? 'unknown' : t;
  };
  // Folder badge: "<root>" when entry lives at path root (no directory component)
  const rootBadge = rawFolder ? folder : '<root>';

  // AHX: artist is always the path prefix; never split on dash
  if (entry.playerId === 'ahx') {
    return {
      artist: normArtist(folder),
      title: baseName.replace(/\.\w+$/i, '').replace(/_/g, ' '),
      folder: rawFolder ? '' : '<root>'
    };
  }

  // Try splitting filename on " – " (en-dash) or " - " (hyphen)
  const enDash = baseName.indexOf(' \u2013 ');
  const hyphen = baseName.indexOf(' - ');
  const dashIdx = enDash >= 0 ? enDash : hyphen;

  if (dashIdx >= 0) {
    // artist from filename left-of-dash; folder badge from path prefix (or <root>)
    const artistStr = baseName.substring(0, dashIdx).replace(/_/g, ' ');
    const title = baseName.substring(dashIdx + 3).replace(/\.\w+$/i, '').replace(/_/g, ' ');
    return { artist: normArtist(artistStr), title, folder: rootBadge };
  }

  // No dash: path prefix IS the artist — put it in artist slot, no folder badge
  return {
    artist: normArtist(folder),
    title: baseName.replace(/\.\w+$/i, '').replace(/_/g, ' '),
    folder: rawFolder ? '' : '<root>'
  };
}

export function extractArtist(entry) {
  const slash = entry.name.lastIndexOf('/');
  if (slash < 0) return '';
  if (entry.playerId === 'ahx') return trimDisplayPath(entry.name.substring(0, slash));
  const fileName = entry.name.substring(slash + 1);
  const dashIdx = fileName.indexOf(' \u2013 ') >= 0
    ? fileName.indexOf(' \u2013 ')
    : fileName.indexOf(' - ');
  return dashIdx >= 0 ? trimDisplayPath(fileName.substring(0, dashIdx)) : '';
}

export function addLongPress(el, callback, delay = 500) {
  let timer = 0;
  el.addEventListener('touchstart', (e) => {
    timer = setTimeout(() => { e.preventDefault(); callback(); }, delay);
  }, { passive: false });
  el.addEventListener('touchend', () => clearTimeout(timer));
  el.addEventListener('touchmove', () => clearTimeout(timer));
}

export function dbg(msg) {
  debugLog.textContent += msg + '\n';
  debugLog.scrollTop = debugLog.scrollHeight;
}

export function tlog(msg) {
  console.log(msg);
  dbg(msg);
}
