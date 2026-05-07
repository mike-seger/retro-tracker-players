// Shared helpers for SPC and VGM engines.

export function getExt(url) {
  const q = String(url || '').split('?')[0].split('#')[0];
  const dot = q.lastIndexOf('.');
  return dot >= 0 ? q.substring(dot + 1).toLowerCase() : '';
}

export function resolveExt(url, entry) {
  const fromUrl = getExt(url);
  const isSimpleExt = (s) => /^[a-z0-9]+$/i.test(String(s || ''));
  if (isSimpleExt(fromUrl) && fromUrl !== 'blob') return fromUrl;

  const fromEntryExt = String(entry?.ext || '').toLowerCase();
  if (isSimpleExt(fromEntryExt)) return fromEntryExt;

  const fromEntryName = getExt(entry?.name || '');
  if (isSimpleExt(fromEntryName)) return fromEntryName;

  const fromEntryUrl = getExt(entry?.url || '');
  if (isSimpleExt(fromEntryUrl)) return fromEntryUrl;

  return fromUrl;
}

export function clamp01(v) {
  if (!isFinite(v)) return 1;
  return Math.max(0, Math.min(1.5, v));
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
