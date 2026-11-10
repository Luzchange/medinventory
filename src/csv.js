import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDb, listMedications } from './db';
import { listOutstandingCheckouts, listInventoryEvents } from './ledger';

const esc = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// 1. Inventory Balances (Existing + enriched)
const BALANCES_COLUMNS = [
  'id', 'ndc', 'barcode', 'brand_name', 'generic_name', 'strength', 'dosage_form',
  'route', 'labeler', 'package_description', 'stock_unit', 'quantity_available',
  'quantity_quarantined', 'lot_number', 'expiry_date', 'location', 'notes', 'updated_at'
];

// 2. Medication Movement History
const MOVEMENT_COLUMNS = [
  'event_id', 'checkout_id', 'checkout_line_id', 'event_type', 'medication_name',
  'strength', 'product_id', 'lot_number', 'stock_unit', 'quantity', 'source_location',
  'destination_location', 'person_or_team', 'disposition', 'reason', 'recorded_by',
  'event_timestamp', 'expected_return_date', 'notes'
];

// 3. Current Outstanding Check-Outs
const OUTSTANDING_COLUMNS = [
  'checkout_id', 'checkout_line_id', 'medication_name', 'lot_number', 'stock_unit',
  'quantity_checked_out', 'usable_quantity_returned', 'quarantined_quantity_returned',
  'quantity_consumed', 'quantity_wasted_or_lost', 'quantity_outstanding',
  'person_or_team', 'destination', 'issued_at', 'expected_return_date', 'status', 'overdue'
];

function buildCsv(columns, rows) {
  return [
    columns.join(','),
    ...rows.map(r => columns.map(c => esc(r[c])).join(','))
  ].join('\r\n');
}

export async function exportInventoryBalancesCsv() {
  const db = await getDb();
  const meds = await listMedications('');
  if (!meds.length) throw new Error('Inventory is empty.');

  // Fetch quarantined tallies
  const qRows = await db.getAllAsync(`SELECT medication_id, SUM(quantity) as q_sum FROM quarantine_stock WHERE status = 'quarantined' GROUP BY medication_id`);
  const qMap = {};
  qRows.forEach(r => { qMap[r.medication_id] = r.q_sum; });

  const rows = meds.map(m => ({
    id: m.id,
    ndc: m.ndc,
    barcode: m.barcode,
    brand_name: m.brand_name,
    generic_name: m.generic_name,
    strength: m.strength,
    dosage_form: m.dosage_form,
    route: m.route,
    labeler: m.labeler,
    package_description: m.package_description,
    stock_unit: m.stock_unit || 'tablets',
    quantity_available: m.quantity,
    quantity_quarantined: qMap[m.id] || 0,
    lot_number: m.lot_number,
    expiry_date: m.expiry_date,
    location: m.location,
    notes: m.notes,
    updated_at: m.updated_at,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}inventory-balances-${stamp}.csv`;
  await FileSystem.writeAsStringAsync(uri, '\uFEFF' + buildCsv(BALANCES_COLUMNS, rows), { encoding: FileSystem.EncodingType.UTF8 });
  await shareFile(uri, 'Export Inventory Balances');
  return uri;
}

export async function exportMovementHistoryCsv(filters = {}) {
  const db = await getDb();
  const events = await listInventoryEvents(db, { limit: 2000, ...filters });
  if (!events.length) throw new Error('No movement events found to export.');

  // Join checkouts for expected_return_date if applicable
  const checkouts = await db.getAllAsync('SELECT checkout_id, expected_return_date FROM checkouts');
  const coMap = {};
  checkouts.forEach(c => { coMap[c.checkout_id] = c.expected_return_date; });

  const rows = events.map(e => ({
    event_id: e.event_id,
    checkout_id: e.checkout_id || 'N/A',
    checkout_line_id: e.checkout_line_id || 'N/A',
    event_type: e.event_type,
    medication_name: e.brand_name || e.generic_name || `Med #${e.medication_id}`,
    strength: e.strength || '',
    product_id: e.ndc || String(e.medication_id),
    lot_number: e.lot_number || '',
    stock_unit: e.stock_unit,
    quantity: e.quantity,
    source_location: e.source_location || '',
    destination_location: e.destination_location || '',
    person_or_team: e.person_or_team || '',
    disposition: e.disposition || '',
    reason: e.reason || '',
    recorded_by: e.recorded_by,
    event_timestamp: e.event_timestamp,
    expected_return_date: (e.checkout_id && coMap[e.checkout_id]) || '',
    notes: e.notes || '',
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}medication-movement-history-${stamp}.csv`;
  await FileSystem.writeAsStringAsync(uri, '\uFEFF' + buildCsv(MOVEMENT_COLUMNS, rows), { encoding: FileSystem.EncodingType.UTF8 });
  await shareFile(uri, 'Export Movement History');
  return uri;
}

export async function exportOutstandingCheckoutsCsv() {
  const db = await getDb();
  const outstanding = await listOutstandingCheckouts(db, '');
  if (!outstanding.length) throw new Error('No outstanding checkouts found.');

  const rows = outstanding.map(o => ({
    checkout_id: o.checkout_id,
    checkout_line_id: o.line_id,
    medication_name: o.brand_name || o.generic_name || `Med #${o.medication_id}`,
    lot_number: o.lot_number || '',
    stock_unit: o.stock_unit,
    quantity_checked_out: o.checked_out,
    usable_quantity_returned: o.returned_usable,
    quarantined_quantity_returned: o.returned_quarantine,
    quantity_consumed: o.consumed,
    quantity_wasted_or_lost: o.wasted_lost,
    quantity_outstanding: o.outstanding,
    person_or_team: o.person_or_team,
    destination: o.destination || '',
    issued_at: o.created_at,
    expected_return_date: o.expected_return_date || '',
    status: o.status,
    overdue: o.is_overdue ? 'YES' : 'NO',
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}outstanding-checkouts-${stamp}.csv`;
  await FileSystem.writeAsStringAsync(uri, '\uFEFF' + buildCsv(OUTSTANDING_COLUMNS, rows), { encoding: FileSystem.EncodingType.UTF8 });
  await shareFile(uri, 'Export Outstanding Checkouts');
  return uri;
}

async function shareFile(uri, dialogTitle) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
    dialogTitle,
    UTI: 'public.comma-separated-values-text'
  });
}

// Preserve backwards-compatible default export
export const exportAndShareCsv = exportInventoryBalancesCsv;
