import * as SQLite from 'expo-sqlite';

let dbPromise;

export const DB_NAME = 'medinventory.db';

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        -- Core medications catalogue & on-hand physical stock
        CREATE TABLE IF NOT EXISTS medications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ndc TEXT NOT NULL,
          barcode TEXT,
          brand_name TEXT,
          generic_name TEXT,
          labeler TEXT,
          dosage_form TEXT,
          route TEXT,
          strength TEXT,
          package_description TEXT,
          quantity INTEGER NOT NULL DEFAULT 1,
          lot_number TEXT,
          expiry_date TEXT,
          location TEXT,
          notes TEXT,
          stock_unit TEXT NOT NULL DEFAULT 'tablets',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_med_ndc ON medications(ndc);
        CREATE INDEX IF NOT EXISTS idx_med_barcode ON medications(barcode);

        -- Check-out Headers
        CREATE TABLE IF NOT EXISTS checkouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          checkout_id TEXT UNIQUE NOT NULL,
          person_or_team TEXT NOT NULL,
          destination TEXT,
          expected_return_date TEXT,
          issued_by TEXT NOT NULL DEFAULT 'Operator',
          status TEXT NOT NULL DEFAULT 'open', -- 'open', 'partially_reconciled', 'closed'
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_checkouts_cid ON checkouts(checkout_id);
        CREATE INDEX IF NOT EXISTS idx_checkouts_status ON checkouts(status);

        -- Check-out Line Items
        CREATE TABLE IF NOT EXISTS checkout_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          line_id TEXT UNIQUE NOT NULL,
          checkout_id TEXT NOT NULL,
          medication_id INTEGER NOT NULL,
          lot_number TEXT,
          stock_unit TEXT NOT NULL DEFAULT 'tablets',
          quantity_checked_out INTEGER NOT NULL,
          source_location TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (checkout_id) REFERENCES checkouts(checkout_id)
        );
        CREATE INDEX IF NOT EXISTS idx_checkout_items_cid ON checkout_items(checkout_id);
        CREATE INDEX IF NOT EXISTS idx_checkout_items_mid ON checkout_items(medication_id);

        -- Append-only Inventory Event Ledger
        CREATE TABLE IF NOT EXISTS inventory_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT UNIQUE NOT NULL,
          operation_id TEXT UNIQUE NOT NULL, -- Idempotency key
          event_type TEXT NOT NULL, -- 'checkout', 'return_usable', 'return_quarantine', 'consumption', 'waste_loss', 'unlinked_return', 'correction_reversal'
          checkout_id TEXT,
          checkout_line_id TEXT,
          medication_id INTEGER NOT NULL,
          lot_number TEXT,
          stock_unit TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          source_location TEXT,
          destination_location TEXT,
          person_or_team TEXT,
          disposition TEXT, -- 'usable', 'quarantined', 'consumed', 'wasted', 'lost', 'other'
          condition TEXT,
          reason TEXT,
          notes TEXT,
          recorded_by TEXT NOT NULL DEFAULT 'Operator',
          event_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          parent_event_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_events_cid ON inventory_events(checkout_id);
        CREATE INDEX IF NOT EXISTS idx_events_type ON inventory_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_events_med ON inventory_events(medication_id);
        CREATE INDEX IF NOT EXISTS idx_events_time ON inventory_events(event_timestamp);

        -- Quarantined Stock Repository (physically held, non-usable)
        CREATE TABLE IF NOT EXISTS quarantine_stock (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          medication_id INTEGER NOT NULL,
          lot_number TEXT,
          stock_unit TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          location TEXT,
          condition TEXT,
          reason TEXT,
          received_by TEXT NOT NULL DEFAULT 'Operator',
          checkout_id TEXT,
          status TEXT NOT NULL DEFAULT 'quarantined', -- 'quarantined', 'released', 'disposed'
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_quarantine_med ON quarantine_stock(medication_id);
        CREATE INDEX IF NOT EXISTS idx_quarantine_status ON quarantine_stock(status);
      `);

      // Ensure stock_unit column exists in medications if table already existed without it
      try {
        await db.execAsync("ALTER TABLE medications ADD COLUMN stock_unit TEXT NOT NULL DEFAULT 'tablets';");
      } catch {
        // column already exists
      }

      return db;
    })();
  }
  return dbPromise;
}

export async function addMedication(m) {
  const db = await getDb();
  const unit = (m.stock_unit && m.stock_unit.trim()) || inferStockUnit(m.dosage_form, m.package_description);
  const r = await db.runAsync(
    `INSERT INTO medications (ndc, barcode, brand_name, generic_name, labeler, dosage_form, route, strength,
      package_description, quantity, lot_number, expiry_date, location, notes, stock_unit)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [m.ndc || '', m.barcode || '', m.brand_name || '', m.generic_name || '', m.labeler || '', m.dosage_form || '',
     m.route || '', m.strength || '', m.package_description || '', Number(m.quantity) || 0,
     m.lot_number || '', m.expiry_date || '', m.location || '', m.notes || '', unit]
  );
  return r.lastInsertRowId;
}

export async function updateMedication(id, m) {
  const db = await getDb();
  const unit = (m.stock_unit && m.stock_unit.trim()) || 'tablets';
  await db.runAsync(
    `UPDATE medications SET quantity=?, lot_number=?, expiry_date=?, location=?, notes=?, stock_unit=?, updated_at=datetime('now') WHERE id=?`,
    [Number(m.quantity) || 0, m.lot_number || '', m.expiry_date || '', m.location || '', m.notes || '', unit, id]
  );
}

export async function deleteMedication(id) {
  const db = await getDb();
  // Check if any check-outs or inventory events exist for this medication
  const check = await db.getFirstAsync(
    `SELECT COUNT(*) as cnt FROM inventory_events WHERE medication_id = ?`,
    [id]
  );
  if (check && check.cnt > 0) {
    throw new Error('Cannot delete medication with existing audit transaction history. Set quantity to 0 instead.');
  }
  await db.runAsync('DELETE FROM medications WHERE id=?', [id]);
}

export async function listMedications(search = '') {
  const db = await getDb();
  const q = `%${search.trim()}%`;
  return db.getAllAsync(
    `SELECT * FROM medications
     WHERE brand_name LIKE ? OR generic_name LIKE ? OR ndc LIKE ? OR lot_number LIKE ? OR location LIKE ? OR barcode LIKE ?
     ORDER BY CASE WHEN expiry_date='' THEN 1 ELSE 0 END, expiry_date ASC, brand_name ASC`,
    [q, q, q, q, q, q]
  );
}

export async function findByNdc(ndc) {
  const db = await getDb();
  return db.getFirstAsync('SELECT * FROM medications WHERE ndc=? ORDER BY id DESC', [ndc]);
}

export async function findByBarcode(barcode) {
  const db = await getDb();
  return db.getAllAsync('SELECT * FROM medications WHERE barcode=? OR ndc=? ORDER BY id DESC', [barcode, barcode]);
}

export function inferStockUnit(dosageForm = '', packageDesc = '') {
  const text = `${dosageForm} ${packageDesc}`.toLowerCase();
  if (text.includes('tablet') || text.includes('tab')) return 'tablets';
  if (text.includes('capsule') || text.includes('cap')) return 'capsules';
  if (text.includes('vial')) return 'vials';
  if (text.includes('ampule') || text.includes('ampoule')) return 'ampules';
  if (text.includes('bottle')) return 'bottles';
  if (text.includes('syringe')) return 'syringes';
  if (text.includes('inhaler')) return 'inhalers';
  if (text.includes('patch')) return 'patches';
  if (text.includes('ml') || text.includes('liquid') || text.includes('suspension') || text.includes('solution')) return 'mL';
  return 'each';
}
