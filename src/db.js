import * as SQLite from 'expo-sqlite';

let dbPromise;
export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('medinventory.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
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
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_med_ndc ON medications(ndc);
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function addMedication(m) {
  const db = await getDb();
  const r = await db.runAsync(
    `INSERT INTO medications (ndc, barcode, brand_name, generic_name, labeler, dosage_form, route, strength,
      package_description, quantity, lot_number, expiry_date, location, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [m.ndc || '', m.barcode || '', m.brand_name || '', m.generic_name || '', m.labeler || '', m.dosage_form || '',
     m.route || '', m.strength || '', m.package_description || '', Number(m.quantity) || 1,
     m.lot_number || '', m.expiry_date || '', m.location || '', m.notes || '']
  );
  return r.lastInsertRowId;
}

export async function updateMedication(id, m) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE medications SET quantity=?, lot_number=?, expiry_date=?, location=?, notes=?, updated_at=datetime('now') WHERE id=?`,
    [Number(m.quantity) || 0, m.lot_number || '', m.expiry_date || '', m.location || '', m.notes || '', id]
  );
}

export async function deleteMedication(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM medications WHERE id=?', [id]);
}

export async function listMedications(search = '') {
  const db = await getDb();
  const q = `%${search.trim()}%`;
  return db.getAllAsync(
    `SELECT * FROM medications
     WHERE brand_name LIKE ? OR generic_name LIKE ? OR ndc LIKE ? OR lot_number LIKE ? OR location LIKE ?
     ORDER BY CASE WHEN expiry_date='' THEN 1 ELSE 0 END, expiry_date ASC, brand_name ASC`,
    [q, q, q, q, q]
  );
}

export async function findByNdc(ndc) {
  const db = await getDb();
  return db.getFirstAsync('SELECT * FROM medications WHERE ndc=? ORDER BY id DESC', [ndc]);
}
