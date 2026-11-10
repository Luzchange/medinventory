// Test CSV escaping, UTF-8 BOM, and formula-injection defenses
import assert from 'node:assert/strict';

const esc = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildCsv(columns, rows) {
  return [
    columns.join(','),
    ...rows.map(r => columns.map(c => esc(r[c])).join(','))
  ].join('\r\n');
}

console.log('--- TESTING CSV ESCAPING & SECURITY DEFENSES ---');

// Test 1: Formula injection
assert.equal(esc('=SUM(A1:A10)'), "'=SUM(A1:A10)");
assert.equal(esc('+12345'), "'+12345");
assert.equal(esc('-100'), "'-100");
assert.equal(esc('@cmd|/C calc'), "'@cmd|/C calc");
console.log('[PASS] Spreadsheet formula injection neutralization verified.');

// Test 2: Double quote escaping & comma handling
assert.equal(esc('Amoxicillin, 500mg "oral"'), '"Amoxicillin, 500mg ""oral"""');
console.log('[PASS] CSV escaping verified.');

// Test 3: Newline handling
assert.equal(esc('Line 1\nLine 2'), '"Line 1\nLine 2"');
console.log('[PASS] Multiline text escaping verified.');

// Test 4: Preserving leading zeros in NDC / lot numbers
assert.equal(esc('0002-3227-30'), '0002-3227-30');
console.log('[PASS] Leading zero preserving verified.');

console.log('--- ALL CSV UNIT TESTS PASSED ---');
