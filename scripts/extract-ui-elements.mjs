#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const defaultOut = path.join(repoRoot, 'doc', 'elements.json');
  const args = {
    waitMs: 800,
    width: 1366,
    height: 900,
    keepModals: false,
    allVisibleListItems: false,
    defaultOut,
    out: defaultOut,
    screenshot: path.join(repoRoot, 'doc', 'elements-view.png'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) args.url = argv[++i];
    else if (a === '--out' && argv[i + 1]) args.out = path.resolve(repoRoot, argv[++i]);
    else if (a === '--wait-ms' && argv[i + 1]) args.waitMs = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--width' && argv[i + 1]) args.width = Math.max(320, Number(argv[++i]) || 1366);
    else if (a === '--height' && argv[i + 1]) args.height = Math.max(240, Number(argv[++i]) || 900);
    else if (a === '--window-size' && argv[i + 1]) {
      const raw = String(argv[++i]);
      const m = raw.match(/^(\d+)x(\d+)$/i);
      if (m) {
        args.width = Math.max(320, Number(m[1]) || 1366);
        args.height = Math.max(240, Number(m[2]) || 900);
      }
    }
    else if (a === '--screenshot' && argv[i + 1]) args.screenshot = path.resolve(repoRoot, argv[++i]);
    else if (a === '--keep-modals') args.keepModals = true;
    else if (a === '--all-visible-list-items') args.allVisibleListItems = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log('Usage: node scripts/extract-ui-elements.mjs --url <url> [--out doc/elements.json] [--screenshot doc/elements-view.png] [--window-size 1366x900] [--width 1366] [--height 900] [--wait-ms 1000] [--keep-modals] [--all-visible-list-items]');
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

async function annotateElementsForScreenshot(page, rows) {
  const digits = Math.max(2, String(rows.length).length);
  const markers = rows.map((r, idx) => ({
    label: String(idx + 1).padStart(digits, '0'),
    xpath: r.xpath,
    isControl: !!r.isControl,
  }));

  await page.evaluate((items) => {
    document.getElementById('ui-doc-number-style')?.remove();
    document.getElementById('ui-doc-number-overlay')?.remove();

    const style = document.createElement('style');
    style.id = 'ui-doc-number-style';
    style.textContent = `
      #ui-doc-number-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483646;
      }
      .ui-doc-number-bubble {
        position: fixed;
        --tip-h: 9px;
        min-width: 28px;
        height: 28px;
        border-radius: 14px;
        padding: 0 8px;
        background: #1d6dff;
        color: #ffffff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        letter-spacing: 0.02em;
        transform: translate(-50%, calc(-100% - var(--tip-h)));
        text-shadow: 0 1px 0 rgba(0,0,0,0.35);
      }
      .ui-doc-number-bubble::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: calc(-1 * var(--tip-h) + 1px);
        width: 16px;
        height: var(--tip-h);
        transform: translateX(-50%);
        background: #1d6dff;
        clip-path: polygon(50% 100%, 0 0, 100% 0);
      }
      .ui-doc-number-bubble.below {
        transform: translate(-50%, var(--tip-h));
      }
      .ui-doc-number-bubble.below::after {
        top: calc(-1 * var(--tip-h) + 1px);
        bottom: auto;
        clip-path: polygon(50% 0, 0 100%, 100% 100%);
      }
    `;
    document.head.appendChild(style);

    const layer = document.createElement('div');
    layer.id = 'ui-doc-number-overlay';

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

    items.forEach((m) => {
      const node = resolveNode(m.xpath);
      if (!(node instanceof Element)) return;

      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      let anchorX = rect.left + (rect.width / 2);
      if (!m.isControl) {
        const tRect = textBounds(node);
        if (tRect && tRect.width > 0) {
          anchorX = tRect.left + (tRect.width / 2);
        }
      }

      const top = Math.round(Math.max(8, rect.top));
      const left = Math.round(Math.max(8, Math.min(window.innerWidth - 8, anchorX)));
      const bubble = document.createElement('span');
      bubble.className = 'ui-doc-number-bubble';
      const needBelow = rect.top < 48;
      if (needBelow) bubble.classList.add('below');
      bubble.textContent = m.label;
      bubble.style.top = `${top}px`;
      bubble.style.left = `${left}px`;
      layer.appendChild(bubble);
    });

    document.body.appendChild(layer);
  }, markers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: args.width, height: args.height },
    });
    await page.goto(args.url, { waitUntil: 'domcontentloaded' });
    if (args.waitMs > 0) await page.waitForTimeout(args.waitMs);

    if (!args.keepModals) {
      await dismissBlockingOverlays(page);
    }

    await ensureInfoMetadataReady(page);

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
        const category = classify(el);
        const base = slugify(el.id || `${category}-${el.name}`);
        const n = (keyCounts.get(base) || 0) + 1;
        keyCounts.set(base, n);
        const key = n === 1 ? base : `${base}-${n}`;
        return {
          key,
          name: prettyName(el.name),
          category,
          xpath: el.xpath,
          humanXPath: el.humanXPath,
          notes: el.notes || '',
          tag: el.tag,
          ...(el.id ? { id: el.id } : {}),
        };
      });

    await annotateElementsForScreenshot(page, raw);
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
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
