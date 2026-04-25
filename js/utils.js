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
