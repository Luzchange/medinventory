// Test script for MedInventory Authoritative Ledger Engine & Accounting Formulas
// Runs under Node.js >= 22 (uses built-in node:sqlite)

import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

// Shim a lightweight database adapter matching expo-sqlite's async interface
function createSqliteAdapter(filename = ':memory:') {
  const rawDb = new DatabaseSync(filename);
  rawDb.exec('PRAGMA foreign_keys = ON;');

  const adapter = {
    async execAsync(sql) {
      rawDb.exec(sql);
    },
    async runAsync(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      const res = stmt.run(...params);
      return { lastInsertRowId: Number(res.lastInsertRowid), changes: Number(res.changes) };
    },
    async getFirstAsync(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      return stmt.get(...params) || null;
    },
    async getAllAsync(sql, params = []) {
      const stmt = rawDb.prepare(sql);
      return stmt.all(...params);
    },
    async withExclusiveTransactionAsync(action) {
      rawDb.exec('BEGIN EXCLUSIVE TRANSACTION;');
      try {
        const res = await action(adapter);
        rawDb.exec('COMMIT;');
        return res;
      } catch (err) {
        rawDb.exec('ROLLBACK;');
        throw err;
      }
    }
  };

  return adapter;
}

// Import business logic from ledger
import {
  processCheckout,
  processReturn,
  processReconciliation,
  processUnlinkedReturn,
  processReversal,
  getLineItemTallies,
  getInventoryDashboard,
  listOutstandingCheckouts,
} from './src/ledger.js';

async function initSchema(db) {
  await db.execAsync(`
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

    CREATE TABLE IF NOT EXISTS checkouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checkout_id TEXT UNIQUE NOT NULL,
      person_or_team TEXT NOT NULL,
      destination TEXT,
      expected_return_date TEXT,
      issued_by TEXT NOT NULL DEFAULT 'Operator',
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checkout_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id TEXT UNIQUE NOT NULL,
      checkout_id TEXT NOT NULL,
      medication_id INTEGER NOT NULL,
      lot_number TEXT,
      stock_unit TEXT NOT NULL DEFAULT 'tablets',
      quantity_checked_out INTEGER NOT NULL,
      source_location TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      operation_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      checkout_id TEXT,
      checkout_line_id TEXT,
      medication_id INTEGER NOT NULL,
      lot_number TEXT,
      stock_unit TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      source_location TEXT,
      destination_location TEXT,
      person_or_team TEXT,
      disposition TEXT,
      condition TEXT,
      reason TEXT,
      notes TEXT,
      recorded_by TEXT NOT NULL DEFAULT 'Operator',
      event_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      parent_event_id TEXT
    );

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
      status TEXT NOT NULL DEFAULT 'quarantined',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function runTests() {
  console.log('--- STARTING MEDINVENTORY COMPREHENSIVE TESTS ---');
  const db = createSqliteAdapter();
  await initSchema(db);

  // 1. Seed initial medication: 100 tablets
  const medInsert = await db.runAsync(
    `INSERT INTO medications (ndc, brand_name, generic_name, strength, quantity, lot_number, expiry_date, location, stock_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['0002-3227-30', 'Amoxicillin', 'Amoxicillin Trihydrate', '500 mg', 100, 'LOT-A1', '2028-12-31', 'Cabinet 1', 'tablets']
  );
  const medId = medInsert.lastInsertRowId;
  console.log(`[PASS] Initial stock created: Med ID ${medId}, 100 tablets available.`);

  // -------------------------------------------------------------
  // Test Scenario: Acceptance Example
  // 1. Start with 100 tablets available.
  // 2. Check out 20: available = 80; outstanding = 20.
  // 3. Return 8 as usable: available = 88; outstanding = 12.
  // 4. Record 10 as consumed: available = 88; outstanding = 2; consumed = 10.
  // 5. Return 2 to quarantine: available = 88; outstanding = 0; quarantined = 2; consumed = 10.
  // 6. The check-out is closed.
  // 7. Ledger balances: 88 avail + 2 quar + 10 consumed = 100 tablets.
  // -------------------------------------------------------------

  console.log('\n--- Step 2: Check out 20 tablets ---');
  const coRes = await processCheckout(db, {
    items: [{ medication_id: medId, quantity: 20, lot_number: 'LOT-A1', source_location: 'Cabinet 1' }],
    person_or_team: 'ICU Team Alpha',
    destination: 'Room 204',
    expected_return_date: '2026-11-15',
    notes: 'Urgent bedside supply',
    operator: 'Nurse Jenkins',
    operation_id: 'op_test_co_1',
  });
  const checkoutId = coRes.checkout_id;

  let med = await db.getFirstAsync('SELECT quantity FROM medications WHERE id = ?', [medId]);
  let line = await db.getFirstAsync('SELECT line_id FROM checkout_items WHERE checkout_id = ?', [checkoutId]);
  let tallies = await getLineItemTallies(db, line.line_id);

  assert.equal(med.quantity, 80, 'Available stock must be 80');
  assert.equal(tallies.outstanding, 20, 'Outstanding must be 20');
  console.log(`[PASS] Checkout 20: Available = ${med.quantity}, Outstanding = ${tallies.outstanding}`);

  console.log('\n--- Step 3: Return 8 as usable ---');
  await processReturn(db, {
    checkout_id: checkoutId,
    checkout_line_id: line.line_id,
    quantity: 8,
    disposition: 'usable',
    condition: 'intact',
    reason: 'Unused blister intact',
    return_location: 'Cabinet 1',
    operator: 'Nurse Jenkins',
    operation_id: 'op_test_ret_1',
  });

  med = await db.getFirstAsync('SELECT quantity FROM medications WHERE id = ?', [medId]);
  tallies = await getLineItemTallies(db, line.line_id);
  assert.equal(med.quantity, 88, 'Available stock must be 88');
  assert.equal(tallies.returned_usable, 8, 'Returned usable must be 8');
  assert.equal(tallies.outstanding, 12, 'Outstanding must be 12');
  console.log(`[PASS] Return 8 usable: Available = ${med.quantity}, Outstanding = ${tallies.outstanding}`);

  console.log('\n--- Step 4: Record 10 as consumed ---');
  await processReconciliation(db, {
    checkout_id: checkoutId,
    checkout_line_id: line.line_id,
    quantity: 10,
    type: 'consumption',
    reason: 'Administered per order',
    operator: 'Dr. Carter',
    operation_id: 'op_test_rec_1',
  });

  med = await db.getFirstAsync('SELECT quantity FROM medications WHERE id = ?', [medId]);
  tallies = await getLineItemTallies(db, line.line_id);
  assert.equal(med.quantity, 88, 'Available stock must remain 88');
  assert.equal(tallies.consumed, 10, 'Consumed must be 10');
  assert.equal(tallies.outstanding, 2, 'Outstanding must be 2');
  console.log(`[PASS] Record 10 consumed: Available = ${med.quantity}, Outstanding = ${tallies.outstanding}, Consumed = ${tallies.consumed}`);

  console.log('\n--- Step 5: Return 2 to quarantine ---');
  await processReturn(db, {
    checkout_id: checkoutId,
    checkout_line_id: line.line_id,
    quantity: 2,
    disposition: 'quarantined',
    condition: 'opened',
    reason: 'Outer seal broken on cart',
    return_location: 'Quarantine Bin',
    operator: 'Nurse Jenkins',
    operation_id: 'op_test_ret_2',
  });

  med = await db.getFirstAsync('SELECT quantity FROM medications WHERE id = ?', [medId]);
  tallies = await getLineItemTallies(db, line.line_id);
  const qRow = await db.getFirstAsync('SELECT SUM(quantity) as q FROM quarantine_stock WHERE medication_id = ?', [medId]);
  assert.equal(med.quantity, 88, 'Available stock must remain 88 (quarantined does not increase available!)');
  assert.equal(tallies.returned_quarantine, 2, 'Returned quarantine must be 2');
  assert.equal(tallies.outstanding, 0, 'Outstanding must be 0');
  assert.equal(qRow.q, 2, 'Quarantined stock must be 2');
  console.log(`[PASS] Return 2 to quarantine: Available = ${med.quantity}, Quarantined = ${qRow.q}, Outstanding = ${tallies.outstanding}`);

  console.log('\n--- Step 6: Verify Check-Out Status is CLOSED ---');
  const coHeader = await db.getFirstAsync('SELECT status FROM checkouts WHERE checkout_id = ?', [checkoutId]);
  assert.equal(coHeader.status, 'closed', 'Checkout header status must be closed when outstanding = 0');
  console.log(`[PASS] Check-out status is confirmed: ${coHeader.status}`);

  console.log('\n--- Step 7: Verify Ledger Balance Conservation ---');
  const totalLedger = med.quantity + qRow.q + tallies.consumed;
  assert.equal(totalLedger, 100, 'Sum of available (88) + quarantined (2) + consumed (10) must equal 100');
  console.log(`[PASS] Ledger Balance Verified: 88 available + 2 quarantined + 10 consumed = ${totalLedger} (100% accounted)`);

  // -------------------------------------------------------------
  // Validation Rules & Negative Testing
  // -------------------------------------------------------------
  console.log('\n--- Negative Test: Overdraw available stock ---');
  await assert.rejects(
    async () => {
      await processCheckout(db, {
        items: [{ medication_id: medId, quantity: 200, lot_number: 'LOT-A1' }],
        person_or_team: 'Trauma Team',
      });
    },
    /Insufficient stock/,
    'Should reject check-out exceeding available stock'
  );
  console.log('[PASS] Overdraw rejected properly.');

  console.log('\n--- Negative Test: Over-return rejected ---');
  await assert.rejects(
    async () => {
      await processReturn(db, {
        checkout_id: checkoutId,
        checkout_line_id: line.line_id,
        quantity: 5,
        disposition: 'usable',
      });
    },
    /Over-return rejected/,
    'Should reject return greater than outstanding quantity'
  );
  console.log('[PASS] Over-return rejected properly.');

  console.log('\n--- Test: Idempotency (duplicate submissions) ---');
  const dupCheck = await processCheckout(db, {
    items: [{ medication_id: medId, quantity: 1, lot_number: 'LOT-A1' }],
    person_or_team: 'Duplicate Team',
    operation_id: 'op_test_co_1', // reused operation_id
  });
  assert.equal(dupCheck.duplicate, true, 'Should detect duplicate operation_id and prevent double checkout');
  console.log('[PASS] Duplicate submission detected and suppressed.');

  console.log('\n--- Test: Dashboard Aggregations ---');
  const dash = await getInventoryDashboard(db);
  assert.equal(dash.current.available, 88, 'Dashboard available should be 88');
  assert.equal(dash.current.quarantined, 2, 'Dashboard quarantined should be 2');
  assert.equal(dash.current.outstanding, 0, 'Dashboard outstanding should be 0');
  assert.equal(dash.period.checked_out, 20, 'Period checked out should be 20');
  assert.equal(dash.period.usable_returned, 8, 'Period usable returned should be 8');
  assert.equal(dash.period.quarantined_returned, 2, 'Period quarantined returned should be 2');
  assert.equal(dash.period.consumed, 10, 'Period consumed should be 10');
  console.log('[PASS] Dashboard tallies agree with ledger events.');

  console.log('\n--- Test: Auto-quarantine on expired medication return ---');
  // Add expired medication
  const expMed = await db.runAsync(
    `INSERT INTO medications (ndc, brand_name, generic_name, strength, quantity, lot_number, expiry_date, stock_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['0002-9999-99', 'Old Drug', 'Expired Med', '10 mg', 50, 'LOT-EXP', '2020-01-01', 'tablets']
  );
  const expCo = await processCheckout(db, {
    items: [{ medication_id: expMed.lastInsertRowId, quantity: 5, lot_number: 'LOT-EXP' }],
    person_or_team: 'Clinic',
  });
  const expLine = await db.getFirstAsync('SELECT line_id FROM checkout_items WHERE checkout_id = ?', [expCo.checkout_id]);
  const expRet = await processReturn(db, {
    checkout_id: expCo.checkout_id,
    checkout_line_id: expLine.line_id,
    quantity: 5,
    disposition: 'usable', // User tried to mark usable!
  });
  assert.equal(expRet.autoQuarantined, true, 'Expired drug must be auto-quarantined');
  assert.equal(expRet.disposition, 'quarantined');
  const checkExpMed = await db.getFirstAsync('SELECT quantity FROM medications WHERE id = ?', [expMed.lastInsertRowId]);
  assert.equal(checkExpMed.quantity, 45, 'Available stock of expired drug must NOT have increased');
  console.log('[PASS] Expired drug safety policy enforced: automatically rerouted to quarantine.');

  console.log('\n--- ALL TEST SUITES PASSED SUCCESSFULLY ---');
}

runTests().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
