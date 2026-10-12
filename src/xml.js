// Sitemaps/RSS from this site are simple, flat, well-formed XML — a real
// parser dependency isn't worth it just to pull <loc>/<link> text out.
export function extractTagText(xml, tagName) {
  const re = new RegExp(`<${tagName}>([^<]*)</${tagName}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}
