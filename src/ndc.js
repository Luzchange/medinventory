// NDC parsing + openFDA lookup.
const API = 'https://api.fda.gov/drug/ndc.json';

// Reduce a scanned barcode to a 10 or 11 digit NDC string (digits only), or null.
export function extractNdcDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d[0] === '3') return d.slice(1, 11); // UPC-A: 3 + 10-digit NDC + check digit
  if (d.length === 13) return d.slice(2, 12); // EAN-13 with leading 0/3 prefix: best effort
  if (d.length === 10 || d.length === 11) return d;
  return null;
}

// Candidate openFDA product_ndc strings (labeler-product) for the digits.
export function productNdcCandidates(digits) {
  if (!digits) return [];
  const out = [];
  const add = (a, b) => { const v = `${a}-${b}`; if (!out.includes(v)) out.push(v); };
  if (digits.length === 11) {            // 5-4-2 billing format
    add(digits.slice(0, 5), digits.slice(5, 9));
    // openFDA stores un-padded segments, e.g. 0002-3227 or 50580-506
    const l = digits.slice(0, 5), p = digits.slice(5, 9);
    add(l.replace(/^0/, ''), p); add(l, p.replace(/^0/, ''));
    add(l.slice(1), p);
  } else if (digits.length === 10) {      // unknown segmenting: try all 3
    add(digits.slice(0, 4), digits.slice(4, 8));   // 4-4-2
    add(digits.slice(0, 5), digits.slice(5, 8));   // 5-3-2
    add(digits.slice(0, 5), digits.slice(5, 9));   // 5-4-1
  }
  return out;
}

function normalize(r, scanned, ndcUsed) {
  const pkg = (r.packaging || [])[0] || {};
  return {
    ndc: r.product_ndc,
    brand_name: r.brand_name || '',
    generic_name: r.generic_name || '',
    labeler: r.labeler_name || '',
    dosage_form: r.dosage_form || '',
    route: (r.route || []).join(', '),
    strength: (r.active_ingredients || []).map(a => `${a.name} ${a.strength}`).join('; '),
    package_description: pkg.description || '',
    barcode: scanned,
  };
}

// Returns a normalized drug record or null if not found. Throws on network errors.
export async function lookupByBarcode(raw) {
  const digits = extractNdcDigits(raw);
  for (const cand of productNdcCandidates(digits)) {
    const url = `${API}?search=product_ndc:"${encodeURIComponent(cand)}"&limit=1`;
    const res = await fetch(url);
    if (res.status === 404) continue;          // openFDA returns 404 for no matches
    if (!res.ok) throw new Error(`FDA API error ${res.status}`);
    const json = await res.json();
    if (json.results && json.results.length) return normalize(json.results[0], raw, cand);
  }
  return null;
}
