// Text signals in a listing's title/description about who's selling.
// Identical copy of homedirect api/utils/ownerSignals.js — the API keeps the
// same rules for extension captures; change both together.

// The owner explicitly doesn't want agencies to call — such listings are
// kept out of the Prospectare feed by default (owner's wish, complaint risk).
export const NO_AGENCIES_RE = new RegExp([
  "f[aă]r[aă]\\s+(?:intermedieri|agen[tţț]i[ie]?)",
  "agen[tţț]iile\\s+(?:s[aă]\\s+)?(?:se\\s+)?(?:ab[tţț]in|nu\\s+sun)",
  "nu\\s+(?:colaborez|colabor[aă]m|lucrez|lucr[aă]m|accept|accept[aă]m|doresc|vreau)\\s+(?:cu\\s+)?(?:agen[tţț]i|intermediar)",
  "exclus\\s+agen[tţț]i",
  "rog\\s+(?:frumos\\s+)?(?:f[aă]r[aă]\\s+)?agen[tţț]i",
  "nu\\s+(?:sunt|e|este)\\s+(?:o\\s+)?agen[tţț]ie",
  "agen[tţț]iile\\s+(?:nu|s[aă]\\s+nu)",
].join("|"), "i");

// Wording agencies use — a listing with any of these is not treated as a
// private owner's, whatever the portal says.
export const AGENCY_TEXT_RE = new RegExp([
  "comision(?:ul)?\\s+(?:de\\s+)?(?:intermediere|agen[tţț]ie)",
  "comision\\s*:?\\s*[1-9]",
  "consultant\\s+imobiliar",
  "agent\\s+imobiliar",
  "agen[tţț]ia\\s+(?:noastr|imobiliar)",
  "imobiliare\\s+v[aă]\\s+ofer",
  "v[aă]\\s+(?:prezint[aă]m|propunem|oferim)\\s+(?:spre|o\\s+)",
  "\\bs\\.?\\s?r\\.?\\s?l\\.?\\b",
  "\\b(?:id|cod)\\s+(?:intern|ofert[aă])",
  "contract\\s+de\\s+(?:intermediere|exclusivitate)",
  "exclusivitate",
  // developers aren't private owners either
  "dezvoltator",
  "ansamblu(?:l)?\\s+(?:reziden[tţț]ial|imobiliar)",
  "tva\\s+inclus",
  "\\bresidence\\b",
].join("|"), "i");

// Wording private owners use (needed where the portal has no seller-type flag).
export const OWNER_TEXT_RE = new RegExp([
  "proprietar",
  "persoan[aă]\\s+fizic[aă]",
  "f[aă]r[aă]\\s+comision",
  "direct\\s+de\\s+la\\s+proprietar",
  "v[aâ]nd\\s+direct",
  "\\bparticular\\b",
].join("|"), "i");

export const hasNoAgencies = (text) => NO_AGENCIES_RE.test(String(text || ""));
export const looksLikeAgency = (text) => AGENCY_TEXT_RE.test(String(text || ""));
export const looksLikeOwner = (text) => OWNER_TEXT_RE.test(String(text || "")) && !looksLikeAgency(text);
