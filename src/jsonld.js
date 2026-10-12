// Parses the schema.org JSON-LD block every imobiliare.ro listing page
// embeds for SEO. Confirmed live (2026-07-09) against real listing pages:
//   - An "Offer" node carries priceSpecification AND `offeredBy` — the
//     seller. offeredBy is sometimes inlined ({"@type":"Person","name":...}),
//     sometimes just a {"@id":...} ref resolved elsewhere in the @graph.
//   - offeredBy.@type is "Person" for a private owner, "RealEstateAgent"
//     for an agency (with a `legalName` typically ending "S.R.L.").
//   - A "RealEstateListing" node carries the page title (`name`) and canonical `url`.
//   - An "Accommodation" node carries `address` (itself a ref to a
//     PostalAddress node with streetAddress/addressLocality).
const LD_JSON_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

// imobiliare.ro's server-side template HTML-escapes text even inside the
// JSON-LD <script> block (confirmed: raw response bytes contain literal
// "S&#259;rari" instead of "Sărari") — a site bug, not a scraping artifact.
// Decode before use so Romanian diacritics come through clean.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
function decodeEntities(str) {
  if (!str) return str;
  return str.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (match, ent) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

function flattenGraph(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => flattenGraph(n, out)); return; }
  if (typeof node === 'object') {
    out.push(node);
    if (Array.isArray(node['@graph'])) node['@graph'].forEach((n) => flattenGraph(n, out));
  }
}

export function extractJsonLdNodes(html) {
  const nodes = [];
  let m;
  while ((m = LD_JSON_RE.exec(html)) !== null) {
    try {
      flattenGraph(JSON.parse(m[1]), nodes);
    } catch {
      // malformed block — skip
    }
  }
  return nodes;
}

function typesOf(node) {
  const t = node?.['@type'];
  if (!t) return [];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

function hasType(node, re) {
  return typesOf(node).some((t) => re.test(t));
}

function resolveRef(ref, byId) {
  if (!ref) return null;
  if (ref['@type']) return ref; // already inlined
  if (ref['@id']) return byId.get(ref['@id']) || null;
  return null;
}

// Same "prefer richer type over bare Offer" logic as the extension's
// shared-extractor.js findListingNode — ported here for the server-side
// case where we only have raw JSON-LD, not a live DOM.
const LISTING_TYPE_RE = /product|offer|realestatelisting|apartment|house|singlefamilyresidence|residence/i;
const OFFER_ONLY_TYPE_RE = /^offer$/i;
function findListingNode(nodes) {
  const matches = nodes.filter((n) => hasType(n, LISTING_TYPE_RE));
  if (!matches.length) return null;
  const richer = matches.find((n) => !typesOf(n).some((t) => OFFER_ONLY_TYPE_RE.test(t)));
  return richer || matches[0];
}

function findOfferNode(nodes) {
  return nodes.find((n) => hasType(n, /^offer$/i)) || null;
}

function findAccommodationNode(nodes) {
  return nodes.find((n) => hasType(n, /accommodation/i)) || null;
}

function deriveExternalId(url) {
  const clean = url.split('?')[0].replace(/\/$/, '');
  const trailingDigits = clean.match(/-(\d{6,})$/);
  if (trailingDigits) return trailingDigits[1];
  const segments = clean.split('/').filter(Boolean);
  return segments[segments.length - 1] || null;
}

function deriveType(url) {
  if (/de-inchiriat/i.test(url)) return 'rent';
  if (/de-vanzare/i.test(url)) return 'buy';
  return null;
}

// Accommodation.numberOfRooms isn't populated in this site's JSON-LD, but
// Romanian listing titles reliably state it ("... 3 camere ..."). Titles
// are unambiguous for this (unlike surface, where a description can
// mention several different m² figures — land, built, total — with no
// reliable way to tell which one a bare regex match belongs to; so surface
// is left JSON-LD-only rather than guessed).
function deriveRoomsFromTitle(title) {
  const m = title?.match(/(\d+)\s*camere/i);
  return m ? parseInt(m[1], 10) : null;
}

// Returns { ownerType: 'Person'|'RealEstateAgent'|null, listing: {...} }.
// `listing` is null when the page didn't have parseable JSON-LD at all
// (caller should treat that as a soft failure, not necessarily a block —
// see CONSECUTIVE_FAILURE_ABORT).
export function extractListing(html, sourceUrl) {
  const nodes = extractJsonLdNodes(html);
  if (!nodes.length) return { ownerType: null, listing: null };

  const byId = new Map(nodes.filter((n) => n['@id']).map((n) => [n['@id'], n]));
  const listingNode = findListingNode(nodes);
  const offerNode = findOfferNode(nodes);
  const offeredBy = resolveRef(offerNode?.offeredBy, byId);
  const accommodation = findAccommodationNode(nodes);
  const address = resolveRef(accommodation?.address, byId) || resolveRef(listingNode?.address, byId);

  const ownerType = offeredBy?.['@type'] || null;

  const title = decodeEntities(listingNode?.name) || null;
  const streetAddress = decodeEntities(address?.streetAddress);
  const addressLocality = decodeEntities(address?.addressLocality);

  const listing = {
    externalId: deriveExternalId(sourceUrl),
    sourceUrl,
    title,
    description: decodeEntities((listingNode?.description || '').slice(0, 3000)) || null,
    type: deriveType(sourceUrl),
    price: Number.isFinite(offerNode?.priceSpecification?.price) ? offerNode.priceSpecification.price : null,
    currency: offerNode?.priceSpecification?.priceCurrency || null,
    city: addressLocality || null,
    address: [streetAddress, addressLocality].map((s) => s?.trim()).filter(Boolean).join(', ') || null,
    rooms: Number.isFinite(accommodation?.numberOfRooms) ? accommodation.numberOfRooms : deriveRoomsFromTitle(title),
    surface: Number.isFinite(accommodation?.floorSize?.value) ? accommodation.floorSize.value : null,
    ownerName: decodeEntities(offeredBy?.name) || null,
    ownerType,
  };

  return { ownerType, listing };
}
