#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const docStylesPath = path.join(repoRoot, 'doc', 'styles.css');

function loadDocStyles() {
  try {
    return fs.readFileSync(docStylesPath, 'utf8');
  } catch (_) {
    // Keep extractor resilient if styles are temporarily missing.
    return '';
  }
}

function parseArgs(argv) {
  const FIXED_VIEWPORT = { width: 640, height: 480 };
  const PLAIN_VIEWPORT = { width: 700, height: 900 };
  const defaultOut = path.join(repoRoot, 'doc', 'elements.json');
  const args = {
    waitMs: 800,
    width: FIXED_VIEWPORT.width,
    height: FIXED_VIEWPORT.height,
    plainWidth: PLAIN_VIEWPORT.width,
    plainHeight: PLAIN_VIEWPORT.height,
    keepModals: false,
    allVisibleListItems: false,
    defaultOut,
    out: defaultOut,
    screenshot: path.join(repoRoot, 'doc', 'elements-view.png'),
    plainScreenshot: path.join(repoRoot, 'doc', 'app-screensot.png'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) args.url = argv[++i];
    else if (a === '--out' && argv[i + 1]) args.out = path.resolve(repoRoot, argv[++i]);
    else if (a === '--wait-ms' && argv[i + 1]) args.waitMs = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--width' && argv[i + 1]) { i++; }
    else if (a === '--height' && argv[i + 1]) { i++; }
    else if (a === '--window-size' && argv[i + 1]) {
      i++;
    }
    else if (a === '--plain-screenshot' && argv[i + 1]) args.plainScreenshot = path.resolve(repoRoot, argv[++i]);
    else if (a === '--screenshot' && argv[i + 1]) args.screenshot = path.resolve(repoRoot, argv[++i]);
    else if (a === '--keep-modals') args.keepModals = true;
    else if (a === '--all-visible-list-items') args.allVisibleListItems = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log('Usage: node scripts/extract-ui-elements.mjs --url <url> [--out doc/elements.json] [--screenshot doc/elements-view.png] [--plain-screenshot doc/app-screensot.png] [--wait-ms 1000] [--keep-modals] [--all-visible-list-items]');
  console.log('Viewport is fixed at 640x480 for element extraction and annotated screenshot. Plain screenshot is fixed at 700x900.');
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'element';
}

function prettyName(raw) {
  const s = String(raw || '').replace(/[-_]+/g, ' ').trim();
  if (!s) return 'Element';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function classify(el) {
  return el.isControl ? 'control' : 'information';
}

function remapLabelEntry(name, category) {
  const raw = String(name || '').trim();
  if (category !== 'information') return { name: raw, category };
  const m = raw.match(/^(.*)\s+label$/i);
  if (!m) return { name: raw, category };
  const base = String(m[1] || '').trim();
  if (!base) return { name: raw, category };
  return {
    name: `Copy ${base} value`,
    category: 'control',
  };
}

function mergeStaticControls(elements) {
  const extras = [
    {
      key: 'ml-random',
      name: 'Browse random tracks',
      category: 'control',
      xpath: "//*[@id='ml-random']",
      humanXPath: '#ml-random',
      notes: 'control-match; static-control',
      tag: 'button',
      id: 'ml-random',
    },
    {
      key: 'refine-range-btn',
      name: 'Result page',
      category: 'control',
      xpath: "//*[@id='refine-range-btn']",
      humanXPath: '#refine-range-btn',
      notes: 'control-match; static-control',
      tag: 'button',
      id: 'refine-range-btn',
    },
    {
      key: 'ml-add-all',
      name: 'Add all search results',
      category: 'control',
      xpath: "//*[@id='ml-add-all']",
      humanXPath: '#ml-add-all',
      notes: 'control-match; static-control',
      tag: 'button',
      id: 'ml-add-all',
    },
    {
      key: 'control-track-add',
      name: 'Add track',
      category: 'control',
      xpath: "(//button[contains(concat(' ', normalize-space(@class), ' '), ' r-add ')])[1]",
      humanXPath: 'button.r-add (first row)',
      notes: 'control-match; static-control',
      tag: 'button',
    },
  ];

  for (const extra of extras) {
    const exists = elements.some((e) =>
      (extra.id && e.id === extra.id) ||
      e.key === extra.key ||
      e.xpath === extra.xpath
    );
    if (!exists) elements.push(extra);
  }

  return elements;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (_) {
    console.error('Playwright is not installed.');
    console.error('Install it with: npm i -D playwright');
    console.error('Then run: npx playwright install chromium');
    process.exit(1);
  }
}

/**
 * Load the app once to reach its origin, clear all persisted filter/mode state
 * from localStorage, then reload so the app starts in a clean local-mode state
 * with no active folder/artist/format/playlist filters.  This makes the element
 * extraction deterministic regardless of what the user had selected last time.
 */
async function resetToDefaultState(page, url, waitMs) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await page.evaluate(async () => {
    // Wipe all persisted filter/mode context so the app starts in clean local mode.
    localStorage.clear();

    // Force-show the Uncategorized system folder (hidden by default) so local
    // tracks without an artist folder are visible in the first playlist row.
    localStorage.setItem('retrotrap-system-lists-shown-v1', JSON.stringify(['__uncategorized__']));

    // Delete user-playlist IndexedDB so playlist list-count doesn't activate the
    // list filter and hide tracks that don't belong to any user playlist.
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('retrotrap');
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  // Reload with clean state so the app initialises as if opened for the first time.
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (waitMs > 0) await page.waitForTimeout(waitMs);
}

async function dismissBlockingOverlays(page) {
  // Try the safest path first: click explicit cancel/no controls.
  await page.evaluate(() => {
    const clicks = [
      '.confirm-overlay .confirm-no',
      '.confirm-overlay button.confirm-no',
      '.confirm-overlay button[aria-label="Close"]',
      '.confirm-overlay button[title="Close"]',
    ];

    for (const sel of clicks) {
      const btn = document.querySelector(sel);
      if (btn && btn instanceof HTMLElement) {
        btn.click();
      }
    }
  });

  // Allow the UI one micro-cycle to react and remove overlays.
  await page.waitForTimeout(40);

  // Fallback: remove known blocking overlays if still present.
  await page.evaluate(() => {
    const overlays = document.querySelectorAll('.confirm-overlay');
    overlays.forEach((n) => n.remove());
  });
}

async function ensureInfoMetadataReady(page) {
  const taggedCount = await page.evaluate(() => document.querySelectorAll('#info span[data-ui-doc="1"]').length);
  if (taggedCount > 0) return;

  // Trigger one user-like action so metadata spans are rendered into #info.
  await page.evaluate(() => {
    const row =
      document.querySelector('#playlist li.current') ||
      document.querySelector('#playlist li.focused') ||
      document.querySelector('#playlist li.remote:not(.hidden)');
    if (row && row instanceof HTMLElement) row.click();
  });

  // Give async metadata population a short window.
  await page.waitForTimeout(700);
}

async function focusFirstTrack(page) {
  const clicked = await page.evaluate(() => {
    const list = document.getElementById('playlist');
    if (!(list instanceof HTMLElement)) return false;

    const firstVisible = list.querySelector('li:not(.hidden)');
    if (!(firstVisible instanceof HTMLElement)) return false;

    // Match user behavior so app state (focused/current row) is consistent for docs.
    firstVisible.click();
    firstVisible.scrollIntoView({ block: 'nearest' });

    return true;
  });

  if (!clicked) return;

  // loadAndPlay() applies classes after async engine setup; wait for it.
  try {
    await page.waitForFunction(() => {
      const firstVisible = document.querySelector('#playlist li:not(.hidden)');
      return !!(firstVisible && (firstVisible.classList.contains('current') || firstVisible.classList.contains('focused')));
    }, { timeout: 3500 });
  } catch (_) {
    // Fallback: force visual focus/current state so screenshot stays deterministic.
    await page.evaluate(() => {
      const list = document.getElementById('playlist');
      if (!(list instanceof HTMLElement)) return;
      const firstVisible = list.querySelector('li:not(.hidden)');
      if (!(firstVisible instanceof HTMLElement)) return;

      list.querySelectorAll('li.current, li.focused').forEach((li) => {
        li.classList.remove('current');
        li.classList.remove('focused');
      });

      firstVisible.classList.add('current');
      firstVisible.classList.add('focused');
    });
  }

  // Allow UI classes/metadata updates to settle before extraction/screenshot.
  await page.waitForTimeout(180);
}

async function annotateElementsForScreenshot(page, rows, docStyles) {
  const digits = Math.max(2, String(rows.length).length);
  const markers = rows.map((r, idx) => ({
    label: String(idx + 1).padStart(digits, '0'),
    xpath: r.xpath,
    isControl: !!r.isControl,
  }));

  await page.evaluate((payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const cssText = String(payload?.cssText || '');
    document.getElementById('ui-doc-number-style')?.remove();
    document.getElementById('ui-doc-number-overlay')?.remove();

    const style = document.createElement('style');
    style.id = 'ui-doc-number-style';
    style.textContent = String(cssText || '');
    document.head.appendChild(style);

    const layer = document.createElement('div');
    layer.id = 'ui-doc-number-overlay';
    document.body.appendChild(layer);

    function resolveNode(xpath) {
      try {
        return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      } catch (_) {
        return null;
      }
    }

    function textBounds(node) {
      if (!(node instanceof Element)) return null;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode(textNode) {
          return /\S/.test(textNode.textContent || '')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });

      let union = null;
      while (walker.nextNode()) {
        const t = walker.currentNode;
        const range = document.createRange();
        range.selectNodeContents(t);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        if (!union) {
          union = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        } else {
          union.left = Math.min(union.left, rect.left);
          union.right = Math.max(union.right, rect.right);
          union.top = Math.min(union.top, rect.top);
          union.bottom = Math.max(union.bottom, rect.bottom);
        }
      }

      if (!union) return null;
      return {
        left: union.left,
        top: union.top,
        width: Math.max(0, union.right - union.left),
        height: Math.max(0, union.bottom - union.top),
      };
    }

    const placedRects = [];

    function intersects(a, b, pad = 3) {
      return !(a.right + pad < b.left || a.left - pad > b.right || a.bottom + pad < b.top || a.top - pad > b.bottom);
    }

    function collides(rect) {
      for (const r of placedRects) {
        if (intersects(rect, r)) return true;
      }
      return false;
    }

    // Build enriched item list with geometry so we can do two passes.
    const enriched = items.map((m) => {
      const node = resolveNode(m.xpath);
      if (!(node instanceof Element)) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const tRect = !m.isControl ? textBounds(node) : null;
      const eff = (tRect && tRect.width > 0 && tRect.height > 0) ? tRect : rect;
      const isInfoMeta = !!node.closest('#info .info-field');
      const isWide = isInfoMeta || (eff.width >= 72 && eff.width >= (eff.height * 2.0));
      return { m, eff, isWide };
    });

    // Two-pass placement: narrow first so wide elements can avoid them.
    const passOrder = [false, true]; // narrow pass, then wide pass
    passOrder.forEach((wantWide) => {
      enriched.forEach((item) => {
        if (!item) return;
        const { m, eff, isWide } = item;
        if (isWide !== wantWide) return;

        const anchorX = eff.left + (eff.width / 2);
        const anchorY = isWide ? (eff.top + (eff.height / 2)) : eff.top;

        const top0 = Math.round(Math.max(8, Math.min(window.innerHeight - 8, anchorY)));
        const left0 = Math.round(Math.max(8, Math.min(window.innerWidth - 8, anchorX)));
        const bubble = document.createElement('span');
        bubble.className = 'ui-doc-number-bubble';
        if (!isWide) {
          const needBelow = eff.top < 48;
          if (needBelow) bubble.classList.add('below');
        }
        bubble.textContent = m.label;

        const setSide = (side) => {
          bubble.classList.remove('side-right', 'side-left');
          if (side) bubble.classList.add(side);
        };

        const setPos = (x, y) => {
          bubble.style.left = `${Math.round(x)}px`;
          bubble.style.top = `${Math.round(y)}px`;
          return bubble.getBoundingClientRect();
        };

        layer.appendChild(bubble);

        let chosen = null;
        if (isWide) {
          // Wide elements: try right-shift first using left-pointing tip, then left-shift.
          const rightCandidates = [];
          const leftCandidates = [];
          for (let step = 0; step <= 10; step++) {
            const dx = step * 24;
            rightCandidates.push({ x: Math.min(eff.right - 8, left0 + dx), y: top0, side: 'side-left' });
            leftCandidates.push({ x: Math.max(eff.left + 8, left0 - dx), y: top0, side: 'side-right' });
          }

          const withinElementX = (r) => r.left >= (eff.left - 1) && r.right <= (eff.right + 1);

          const tryCandidates = (arr) => {
            for (const c of arr) {
              setSide(c.side);
              const r = setPos(c.x, c.y);
              const inside = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
              if (!inside) continue;
              if (!withinElementX(r)) continue;
              if (!collides(r)) return r;
            }
            return null;
          };

          chosen = tryCandidates(rightCandidates) || tryCandidates(leftCandidates);
          if (!chosen) {
            // Fallback: keep horizontal and inside the referenced element, even if overlap is unavoidable.
            setSide('side-left');
            let fallback = setPos(left0, top0);
            if (!withinElementX(fallback)) {
              setSide('side-right');
              fallback = setPos(left0, top0);
            }
            chosen = fallback;
          }
        } else {
          const candidates = [{ x: left0, y: top0 }];
          // Non-wide elements keep top/below behavior, then nudge to avoid overlaps.
          for (let step = 1; step <= 6; step++) {
            const dy = step * 16;
            candidates.push({ x: left0, y: Math.min(window.innerHeight - 8, top0 + dy) });
            candidates.push({ x: left0, y: Math.max(8, top0 - dy) });
          }

          for (const c of candidates) {
            const r = setPos(c.x, c.y);
            const inside = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
            if (!inside) continue;
            if (!collides(r)) {
              chosen = r;
              break;
            }
          }

          if (!chosen) {
            chosen = setPos(left0, top0);
          }
        }

        placedRects.push(chosen);
      });
    });
  }, { items: markers, cssText: docStyles });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const { chromium } = await loadPlaywright();
  const docStyles = loadDocStyles();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: args.width, height: args.height },
    });
    // Load the page, clear persisted filter/mode state, reload with clean local-mode state.
    await resetToDefaultState(page, args.url, args.waitMs);

    if (!args.keepModals) {
      await dismissBlockingOverlays(page);
    }

    await ensureInfoMetadataReady(page);
    await focusFirstTrack(page);

    if (args.plainScreenshot) {
      await page.setViewportSize({ width: args.plainWidth, height: args.plainHeight });
      await ensureInfoMetadataReady(page);
      await focusFirstTrack(page);
      fs.mkdirSync(path.dirname(args.plainScreenshot), { recursive: true });
      await page.screenshot({ path: args.plainScreenshot, fullPage: false });
      await page.setViewportSize({ width: args.width, height: args.height });
      await ensureInfoMetadataReady(page);
      await focusFirstTrack(page);
    }

    const raw = await page.evaluate((includeAllVisibleListItems) => {
      const TEXT_RE = /[A-Za-z0-9?\-]+/;
      const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);

      function normalizeText(s) {
        return String(s || '').replace(/\s+/g, ' ').trim();
      }

      function ownText(el) {
        let out = '';
        for (const n of el.childNodes) {
          if (n.nodeType === Node.TEXT_NODE) out += ` ${n.textContent || ''}`;
        }
        return normalizeText(out);
      }

      function getElementText(el) {
        const direct = ownText(el);
        if (direct) return direct;
        const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '');
        if (label) return label;
        if (el instanceof HTMLInputElement) return normalizeText(el.value || '');
        if (el instanceof HTMLSelectElement) return normalizeText(el.selectedOptions?.[0]?.textContent || '');
        return '';
      }

      function isVisible(el) {
        if (!el || !(el instanceof Element)) return false;
        if (el.hidden || el.closest('[hidden]')) return false;
        if (el.classList.contains('hidden') || el.closest('.hidden')) return false;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        if (r.bottom <= 0 || r.right <= 0) return false;
        if (r.top >= window.innerHeight || r.left >= window.innerWidth) return false;
        return true;
      }

      function isControl(el) {
        const tag = el.tagName.toLowerCase();
        return CONTROL_TAGS.has(tag) || (tag === 'a' && !!el.getAttribute('href')) || el.getAttribute('role') === 'button';
      }

      function matchesTextCriterion(el) {
        return TEXT_RE.test(getElementText(el));
      }

      function isTimeDisplay(el) {
        if (!(el instanceof HTMLElement)) return false;
        if (el.id === 'time' || el.id === 'duration') return true;
        return el.classList.contains('time');
      }

      function hasVisibleControlDescendant(el) {
        const descendants = el.querySelectorAll('button, input, select, textarea, a[href], [role="button"]');
        for (const d of descendants) {
          if (isVisible(d)) return true;
        }
        return false;
      }

      function shouldIncludeListItem(el) {
        if (includeAllVisibleListItems) return true;

        const li = el.closest('li');
        if (!li) return true;

        const parentList = li.closest('ul, ol');
        if (!parentList) return true;

        const visibleItems = Array.from(parentList.querySelectorAll(':scope > li')).filter((item) => isVisible(item));
        return visibleItems[0] === li;
      }

      function escLit(value) {
        if (!value.includes("'")) return `'${value}'`;
        if (!value.includes('"')) return `"${value}"`;
        const parts = value.split("'").map((p) => `'${p}'`);
        return `concat(${parts.join(', "\'", ')})`;
      }

      function xpathCount(xpath) {
        return document.evaluate(`count(${xpath})`, document, null, XPathResult.NUMBER_TYPE, null).numberValue;
      }

      function isUnique(xpath) {
        try { return xpathCount(xpath) === 1; } catch (_) { return false; }
      }

      function absoluteXPath(node) {
        const segments = [];
        let cur = node;
        while (cur && cur.nodeType === Node.ELEMENT_NODE) {
          const tag = cur.tagName.toLowerCase();
          let idx = 1;
          let sib = cur.previousElementSibling;
          while (sib) {
            if (sib.tagName === cur.tagName) idx++;
            sib = sib.previousElementSibling;
          }
          segments.unshift(`${tag}[${idx}]`);
          cur = cur.parentElement;
          if (cur && cur.tagName.toLowerCase() === 'html') {
            segments.unshift('html[1]');
            break;
          }
        }
        return '/' + segments.join('/');
      }

      function makeXPath(el) {
        if (el.id) return `//*[@id=${escLit(el.id)}]`;

        const attrs = ['data-action', 'aria-label', 'title', 'name'];
        for (const attr of attrs) {
          const val = el.getAttribute(attr);
          if (!val) continue;
          const xp = `//${el.tagName.toLowerCase()}[@${attr}=${escLit(val)}]`;
          if (isUnique(xp)) return xp;
        }

        if (el.tagName.toLowerCase() === 'input') {
          const type = el.getAttribute('type');
          if (type) {
            const xp = `//input[@type=${escLit(type)}]`;
            if (isUnique(xp)) return xp;
          }
        }

        return absoluteXPath(el);
      }

      function makeHumanPath(el) {
        if (el.id) return `#${el.id}`;
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
          let seg = cur.tagName.toLowerCase();
          if (cur.id) seg += `#${cur.id}`;
          else if (cur.classList.length) seg += `.${cur.classList[0]}`;
          parts.unshift(seg);
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      }

      function inferName(el, textValue) {
        const n = normalizeText(
          el.getAttribute('aria-label')
          || el.getAttribute('title')
          || el.getAttribute('placeholder')
          || el.id
          || textValue
          || `${el.tagName.toLowerCase()} element`
        );
        return n.slice(0, 80);
      }

      const seen = new Set();
      const rows = [];
      const all = document.querySelectorAll('*');
      all.forEach((el) => {
        if (!isVisible(el)) return;
        if (!shouldIncludeListItem(el)) return;
        const forcedInclude = el.getAttribute('data-ui-doc') === '1';
        const control = isControl(el);
        const textValue = getElementText(el);
        const textMatch = matchesTextCriterion(el);
        if (!forcedInclude && !control && !textMatch && !isTimeDisplay(el)) return;
        if (seen.has(el)) return;
        // Skip non-control wrapper elements whose only text match comes from title/aria-label
        // and that already have a visible control descendant (the child is the real entry)
        if (!forcedInclude && !control && !ownText(el) && hasVisibleControlDescendant(el)) return;
        seen.add(el);

        const tag = el.tagName.toLowerCase();
        const id = el.id || undefined;
        const text = textValue.slice(0, 120);
        const name = inferName(el, textValue);
        const rect = el.getBoundingClientRect();
        const notesParts = [];
        if (control) notesParts.push('control-match');
        if (textMatch) notesParts.push('text-match');
        if (el.hasAttribute('hidden')) notesParts.push('hidden by default');
        if (el.getAttribute('data-action')) notesParts.push(`action=${el.getAttribute('data-action')}`);

        rows.push({
          tag,
          id,
          isControl: control,
          name,
          text,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          xpath: makeXPath(el),
          humanXPath: makeHumanPath(el),
          notes: notesParts.join('; '),
        });
      });

      rows.sort((a, b) => (a.top - b.top) || (a.left - b.left) || a.name.localeCompare(b.name));
      return rows;
    }, args.allVisibleListItems);

    const keyCounts = new Map();
    const elements = raw
      .map((el) => {
        const mapped = remapLabelEntry(el.name, classify(el));
        const category = mapped.category;
        const finalName = mapped.name;
        const base = slugify(el.id || `${category}-${finalName}`);
        const n = (keyCounts.get(base) || 0) + 1;
        keyCounts.set(base, n);
        const key = n === 1 ? base : `${base}-${n}`;
        return {
          key,
          name: prettyName(finalName),
          category,
          xpath: el.xpath,
          humanXPath: el.humanXPath,
          notes: el.notes || '',
          tag: el.tag,
          ...(el.id ? { id: el.id } : {}),
        };
      });

    mergeStaticControls(elements);

    await annotateElementsForScreenshot(page, raw, docStyles);
    fs.mkdirSync(path.dirname(args.screenshot), { recursive: true });
    await page.screenshot({ path: args.screenshot, fullPage: false });

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceUrl: args.url,
      screenshotPath: path.relative(repoRoot, args.screenshot).split(path.sep).join('/'),
      viewport: { width: args.width, height: args.height },
      stats: {
        total: elements.length,
        controls: elements.filter((e) => e.category === 'control').length,
        information: elements.filter((e) => e.category === 'information').length,
      },
      elements,
    };

    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    if (path.resolve(args.out) !== path.resolve(args.defaultOut)) {
      fs.mkdirSync(path.dirname(args.defaultOut), { recursive: true });
      fs.writeFileSync(args.defaultOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }
    console.log(`Wrote ${elements.length} elements to ${args.out}`);
    if (path.resolve(args.out) !== path.resolve(args.defaultOut)) {
      console.log(`Synced ${elements.length} elements to ${args.defaultOut}`);
    }
    console.log(`Saved screenshot to ${args.screenshot}`);
    if (args.plainScreenshot) {
      console.log(`Saved plain screenshot to ${args.plainScreenshot}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
