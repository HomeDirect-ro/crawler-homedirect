// Shared helpers for turning a portal's ad into the MarketListing snapshot
// the API ingests. No owner name / phone ever goes into a snapshot.

// Same rule as the extension's shared-extractor.js deriveExternalId — the
// API's dedupe key for AgencyProspect, so a feed "Preia" and a later
// extension capture of the same ad land on ONE prospect. Don't change it
// without changing the extension.
export function deriveExternalId(url) {
  const clean = String(url).split('?')[0].replace(/\/$/, '');
  const idSuffix = clean.match(/-ID([A-Za-z0-9]+)(?:\.html)?$/i);
  if (idSuffix) return idSuffix[1];
  const segments = clean.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (last) return last.replace(/\.html$/i, '');
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) | 0;
  return `h${Math.abs(hash)}`;
}

// Portal category / estate words → MarketListing.propertyType.
export function propertyTypeFrom(text) {
  const s = String(text || '').toLowerCase();
  if (/garsonier|apartament|\bflat\b|studio/.test(s)) return 'apartment';
  if (/\bcas[aăe]\b|case-|vil[aă]|house|duplex/.test(s)) return 'house';
  if (/teren|terrain|\bplot\b|land/.test(s)) return 'land';
  if (/birou|office/.test(s)) return 'office';
  if (/spa[tț]i[ui]?.?comercial|comercial|commercial/.test(s)) return 'commercial';
  if (/garaj|parcar|garage/.test(s)) return 'garage';
  if (/industrial|hal[aă]|depozit|warehouse/.test(s)) return 'industrial';
  if (/\bcamer[aă]\b|\broom\b/.test(s)) return 'room';
  return null;
}

export function roomsFrom(text) {
  const s = String(text || '').toLowerCase();
  if (/garsonier/.test(s)) return 1;
  const m = s.match(/(\d+)\s*(?:camere|cam\.|camera)/);
  return m ? Math.min(parseInt(m[1], 10), 20) : null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(str) {
  if (!str) return str;
  return String(str).replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ent.toLowerCase()] ?? m;
  });
}

export const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, n) : null;
};
