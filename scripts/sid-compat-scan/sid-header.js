'use strict';

/**
 * sid-header.js
 *
 * Parse a SID file binary header and decide whether jsSID can play it.
 * All offset and address rules are derived directly from jsSID.js source.
 *
 * Returns a plain object:
 *   {
 *     valid        : boolean  // false if file is too short or magic is wrong
 *     magic        : string   // "PSID" | "RSID" | ""
 *     version      : number
 *     loadAddr     : number   // 0 = embedded in data (lo/hi at data start)
 *     initAddr     : number
 *     playAddr     : number
 *     numSongs     : number   // corrected: 0 → 1
 *     defaultSong  : number
 *     title        : string
 *     author       : string
 *     released     : string
 *     sid1Model    : 6581|8580
 *     sid2Model    : 6581|8580
 *     sid3Model    : 6581|8580
 *     sid2Addr     : number   // 0 if not present or invalid
 *     sid3Addr     : number   // 0 if not present or invalid
 *     sidCount     : number   // 1–3
 *     jsSID_compatible : boolean
 *     reason       : string   // "" when compatible, short description when not
 *   }
 */

const MIN_HEADER = 0x76; // minimum valid SID header length

/**
 * Read a null-terminated ISO-8859-1 string from buffer slice.
 * jsSID stops at the first 0x00 byte inside each 32-byte field.
 */
function readField(buf, offset, len) {
  const slice = buf.slice(offset, offset + len);
  const nullIdx = slice.indexOf(0);
  const end = nullIdx >= 0 ? nullIdx : len;
  return String.fromCharCode(...slice.slice(0, end));
}

/**
 * Validate a secondary SID base-address nibble (as stored in bytes 0x7A / 0x7B).
 * Must be in [0x42, 0x7F] or [0xE0, 0xFF].
 * Mirrors: SID_address[1]=fdat[0x7A]>=0x42&&(fdat[0x7A]<0x80||fdat[0x7A]>=0xE0)?...
 */
function validSIDAddrNibble(nibble) {
  return nibble >= 0x42 && (nibble < 0x80 || nibble >= 0xE0);
}

/**
 * Parse buf (Node Buffer or Uint8Array) and return header fields + compatibility.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {object}
 */
function parseSIDHeader(buf) {
  const result = {
    valid: false,
    magic: '',
    version: 0,
    loadAddr: 0,
    initAddr: 0,
    playAddr: 0,
    numSongs: 1,
    defaultSong: 0,
    title: '',
    author: '',
    released: '',
    sid1Model: 8580,
    sid2Model: 8580,
    sid3Model: 8580,
    sid2Addr: 0,
    sid3Addr: 0,
    sidCount: 1,
    jsSID_compatible: false,
    reason: '',
  };

  if (!buf || buf.length < MIN_HEADER) {
    result.reason = 'file_too_short';
    return result;
  }

  // Magic: "PSID" (0x50534944) or "RSID" (0x52534944)
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'PSID' && magic !== 'RSID') {
    result.reason = `bad_magic:${magic.replace(/[^\x20-\x7E]/g, '?')}`;
    return result;
  }

  result.valid = true;
  result.magic = magic;

  // Version (big-endian word at 0x04)
  result.version = (buf[4] << 8) | buf[5];

  // Data offset (byte 0x07 — low byte of the word at 0x06)
  const dataOffset = buf[7]; // high byte buf[6] is always 0 in practice

  // Load address: if 0x0008–0x0009 are both zero, the first two bytes of data
  // carry the little-endian load address (jsSID: ldad = fdat[8]+fdat[9] ? ... : fdat[offs]+fdat[offs+1]*256)
  const loadHi = buf[8];
  const loadLo = buf[9]; // actually jsSID uses fdat[8]*256 + fdat[9] for big-endian word
  result.loadAddr = (loadHi || loadLo) ? (loadHi * 256 + loadLo) : 0;

  // Init and play addresses (big-endian words)
  result.initAddr = (buf[0x0A] * 256) + buf[0x0B]; // jsSID: fdat[0xA]*256+fdat[0xB]
  result.playAddr = (buf[0x0C] * 256) + buf[0x0D]; // jsSID: fdat[0xC]*256+fdat[0xD]

  // Subtune count (byte 0x0F — note jsSID uses fdat[0xF], not fdat[0x0E])
  result.numSongs   = buf[0x0F] || 1;
  result.defaultSong = buf[0x11] || 1;

  // Metadata fields (3 × 32 bytes, null-terminated)
  result.title    = readField(buf, 0x16, 32);
  result.author   = readField(buf, 0x36, 32);
  result.released = readField(buf, 0x56, 32);

  // SID chip models (v2+ only; bytes 0x76–0x77)
  // jsSID: prSIDm[0]=(fdat[0x77]&0x30)>=0x20?8580:6581  (SID 2 model — confusingly at 0x77 low nibble)
  //        prSIDm[1]=(fdat[0x77]&0xC0)>=0x80?8580:6581  (SID 3 model — high nibble of 0x77)
  //        prSIDm[2]=(fdat[0x76]&3)>=3?8580:6581         (SID 1 model — low 2 bits of 0x76)
  // Note: prSIDm[0] is what jsSID calls "preferred model" for SID 1 display purposes.
  if (result.version >= 2 && buf.length > 0x77) {
    result.sid1Model  = (buf[0x76] & 3) >= 3  ? 8580 : 6581;
    result.sid2Model  = (buf[0x77] & 0x30) >= 0x20 ? 8580 : 6581;
    result.sid3Model  = (buf[0x77] & 0xC0) >= 0x80 ? 8580 : 6581;
  }

  // Multi-SID addresses (v2+ only; bytes 0x7A–0x7B)
  if (result.version >= 2 && buf.length > 0x7B) {
    const n2 = buf[0x7A];
    const n3 = buf[0x7B];
    result.sid2Addr = validSIDAddrNibble(n2) ? (0xD000 + n2 * 16) : 0;
    result.sid3Addr = validSIDAddrNibble(n3) ? (0xD000 + n3 * 16) : 0;
  }
  result.sidCount = 1 + (result.sid2Addr > 0 ? 1 : 0) + (result.sid3Addr > 0 ? 1 : 0);

  // ── Compatibility decision ───────────────────────────────────────────────
  // jsSID can attempt to play any PSID or RSID file.
  // RSID files require real C64 environment interrupts; they may produce no audio
  // but jsSID will still try (and may succeed).  We mark them compatible with a note.
  // The only hard incompatibility is an unrecognised magic byte, already caught above.
  result.jsSID_compatible = true;

  if (magic === 'RSID') {
    // Possibly silent, but not structurally incompatible.
    result.reason = 'rsid_uncertain';
  }

  return result;
}

module.exports = { parseSIDHeader };
