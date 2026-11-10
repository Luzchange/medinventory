/**
 * Authoritative Inventory Ledger Service
 *
 * Implements strict accounting equations:
 * 1. Available: Medication physically in usable stock.
 * 2. Outstanding: Medication checked out but not yet returned or accounted for.
 * 3. Consumed: Medication confirmed used.
 * 4. Wasted/Lost: Medication recorded as wasted, damaged, or lost with explanation.
 * 5. Quarantined: Returned medication physically received but not available for use.
 *
 * Equation per checkout line item:
 * outstanding = checked_out - usable_returns - quarantined_returns - consumed - wasted_lost
 * Total stock balance conservation:
 * initial_available = current_available + outstanding + quarantined + consumed + wasted_lost
 */

export function generateId(prefix = 'ev') {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rnd}`;
}

export async function processCheckout(db, {
  items, // array of { medication_id, quantity, lot_number, source_location }
  person_or_team,
  destination = '',
  expected_return_date = '',
  notes = '',
  operator = 'Operator',
  operation_id = generateId('op_co'),
}) {
  if (!items || !items.length) throw new Error('At least one medication item is required.');
  if (!person_or_team || !person_or_team.trim()) throw new Error('Person or team receiving medication is required.');

  // Check idempotency
  const existingOp = await db.getFirstAsync(
    'SELECT event_id, checkout_id FROM inventory_events WHERE operation_id = ? OR operation_id LIKE ?',
    [operation_id, `${operation_id}_%`]
  );
  if (existingOp) {
    return { ok: true, checkout_id: existingOp.checkout_id, duplicate: true };
  }

  const checkout_id = generateId('chk');

  await db.withExclusiveTransactionAsync(async (tx) => {
    // 1. Insert Checkout Header
    await tx.runAsync(
      `INSERT INTO checkouts (checkout_id, person_or_team, destination, expected_return_date, issued_by, status, notes)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [checkout_id, person_or_team.trim(), destination.trim(), expected_return_date.trim(), operator, notes.trim()]
    );

    // 2. Process each line item
    for (const item of items) {
      const qty = Number(item.quantity);
      if (!qty || qty <= 0 || !Number.isInteger(qty)) {
        throw new Error(`Quantity must be a positive whole integer: got ${item.quantity}`);
      }

      // Fetch current medication row
      const med = await tx.getFirstAsync('SELECT * FROM medications WHERE id = ?', [item.medication_id]);
      if (!med) throw new Error(`Medication ID ${item.medication_id} not found.`);

      // Verify sufficient available stock
      if (med.quantity < qty) {
        throw new Error(
          `Insufficient stock for ${med.brand_name || med.generic_name}. Requested: ${qty} ${med.stock_unit}, Available: ${med.quantity} ${med.stock_unit}.`
        );
      }

      // Verify lot number match if specified
      if (item.lot_number && med.lot_number && item.lot_number !== med.lot_number) {
        throw new Error(`Lot mismatch: selected lot ${item.lot_number} does not match medication lot ${med.lot_number}.`);
      }

      const line_id = generateId('line');
      const stock_unit = med.stock_unit || 'tablets';
      const lot_number = item.lot_number || med.lot_number || '';
      const source_loc = item.source_location || med.location || '';

      // Insert line item
      await tx.runAsync(
        `INSERT INTO checkout_items (line_id, checkout_id, medication_id, lot_number, stock_unit, quantity_checked_out, source_location)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [line_id, checkout_id, med.id, lot_number, stock_unit, qty, source_loc]
      );

      // Deduct from available inventory atomically
      await tx.runAsync(
        `UPDATE medications SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`,
        [qty, med.id]
      );

      // Append checkout event to ledger
      const event_id = generateId('evt_co');
      await tx.runAsync(
        `INSERT INTO inventory_events (
           event_id, operation_id, event_type, checkout_id, checkout_line_id,
           medication_id, lot_number, stock_unit, quantity, source_location,
           destination_location, person_or_team, disposition, reason, notes, recorded_by
         ) VALUES (?, ?, 'checkout', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'outstanding', 'Clinical Check Out', ?, ?)`,
        [
          event_id,
          `${operation_id}_${line_id}`,
          checkout_id,
          line_id,
          med.id,
          lot_number,
          stock_unit,
          qty,
          source_loc,
          destination.trim(),
          person_or_team.trim(),
          notes.trim(),
          operator
        ]
      );
    }
  });

  return { ok: true, checkout_id };
}

export async function processReturn(db, {
  checkout_id,
  checkout_line_id,
  quantity,
  disposition, // 'usable' | 'quarantined'
  condition = 'intact', // 'intact', 'opened', 'damaged', 'expired', 'compromised'
  reason = '',
  return_location = '',
  operator = 'Operator',
  notes = '',
  operation_id = generateId('op_ret'),
  policy_allow_usable = true, // policy flag
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0 || !Number.isInteger(qty)) {
    throw new Error(`Return quantity must be a positive integer: got ${quantity}`);
  }
  if (!['usable', 'quarantined'].includes(disposition)) {
    throw new Error(`Disposition must be 'usable' or 'quarantined'. Got '${disposition}'.`);
  }

  // Check idempotency
  const existingOp = await db.getFirstAsync(
    'SELECT event_id FROM inventory_events WHERE operation_id = ?',
    [operation_id]
  );
  if (existingOp) return { ok: true, duplicate: true };

  return await db.withExclusiveTransactionAsync(async (tx) => {
    // 1. Fetch checkout and item
    const checkout = await tx.getFirstAsync('SELECT * FROM checkouts WHERE checkout_id = ?', [checkout_id]);
    if (!checkout) throw new Error(`Check-out ${checkout_id} not found.`);

    const item = await tx.getFirstAsync(
      'SELECT * FROM checkout_items WHERE checkout_id = ? AND line_id = ?',
      [checkout_id, checkout_line_id]
    );
    if (!item) throw new Error(`Check-out line item ${checkout_line_id} not found.`);

    const med = await tx.getFirstAsync('SELECT * FROM medications WHERE id = ?', [item.medication_id]);
    if (!med) throw new Error(`Medication ID ${item.medication_id} not found.`);

    // 2. Calculate current line tallies
    const tallies = await getLineItemTallies(tx, checkout_line_id);
    if (qty > tallies.outstanding) {
      throw new Error(
        `Over-return rejected. Returning ${qty} ${item.stock_unit}, but only ${tallies.outstanding} ${item.stock_unit} remains outstanding.`
      );
    }

    // 3. Clinical & Policy Validation for usable returns
    let finalDisposition = disposition;
    let autoQuarantineReason = '';

    // Check expiration: if expired, cannot be marked usable
    if (med.expiry_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (med.expiry_date < today) {
        if (disposition === 'usable') {
          finalDisposition = 'quarantined';
          autoQuarantineReason = `Automatically quarantined: medication expired on ${med.expiry_date}.`;
        }
      }
    }

    // Check package condition
    if (['opened', 'damaged', 'compromised'].includes(condition)) {
      if (disposition === 'usable') {
        finalDisposition = 'quarantined';
        autoQuarantineReason = `Automatically quarantined: package condition reported as ${condition}.`;
      }
    }

    if (!policy_allow_usable && disposition === 'usable') {
      finalDisposition = 'quarantined';
      autoQuarantineReason = `Automatically quarantined: organization policy disallows direct usable restock.`;
    }

    const loc = (return_location || item.source_location || med.location || '').trim();
    const event_type = finalDisposition === 'usable' ? 'return_usable' : 'return_quarantine';
    const combinedReason = [reason, autoQuarantineReason].filter(Boolean).join(' | ');

    // 4. Update physical balances
    if (finalDisposition === 'usable') {
      // Restores to available stock
      await tx.runAsync(
        `UPDATE medications SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`,
        [qty, med.id]
      );
    } else {
      // Add to Quarantine repository (keeps quarantined quantities separate from available)
      await tx.runAsync(
        `INSERT INTO quarantine_stock (medication_id, lot_number, stock_unit, quantity, location, condition, reason, received_by, checkout_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [med.id, item.lot_number, item.stock_unit, qty, loc, condition, combinedReason, operator, checkout_id]
      );
    }

    // 5. Append event to ledger
    const event_id = generateId('evt_ret');
    await tx.runAsync(
      `INSERT INTO inventory_events (
         event_id, operation_id, event_type, checkout_id, checkout_line_id,
         medication_id, lot_number, stock_unit, quantity, source_location,
         destination_location, person_or_team, disposition, condition, reason, notes, recorded_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event_id,
        operation_id,
        event_type,
        checkout_id,
        checkout_line_id,
        med.id,
        item.lot_number,
        item.stock_unit,
        qty,
        checkout.destination,
        loc,
        checkout.person_or_team,
        finalDisposition,
        condition,
        combinedReason,
        notes.trim(),
        operator
      ]
    );

    // 6. Refresh and update checkout header status
    await updateCheckoutStatus(tx, checkout_id);

    return {
      ok: true,
      disposition: finalDisposition,
      autoQuarantined: finalDisposition !== disposition,
      reason: combinedReason,
    };
  });
}

export async function processReconciliation(db, {
  checkout_id,
  checkout_line_id,
  quantity,
  type, // 'consumption' | 'waste' | 'damaged' | 'lost' | 'other'
  reason = '',
  operator = 'Operator',
  notes = '',
  operation_id = generateId('op_rec'),
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0 || !Number.isInteger(qty)) {
    throw new Error(`Quantity must be a positive integer: got ${quantity}`);
  }
  if (!['consumption', 'waste', 'damaged', 'lost', 'other'].includes(type)) {
    throw new Error(`Invalid reconciliation type: ${type}`);
  }
  if (type !== 'consumption' && (!reason || !reason.trim())) {
    throw new Error(`A detailed explanation/reason is required for ${type}.`);
  }

  // Idempotency
  const existingOp = await db.getFirstAsync(
    'SELECT event_id FROM inventory_events WHERE operation_id = ?',
    [operation_id]
  );
  if (existingOp) return { ok: true, duplicate: true };

  return await db.withExclusiveTransactionAsync(async (tx) => {
    const checkout = await tx.getFirstAsync('SELECT * FROM checkouts WHERE checkout_id = ?', [checkout_id]);
    if (!checkout) throw new Error(`Check-out ${checkout_id} not found.`);

    const item = await tx.getFirstAsync(
      'SELECT * FROM checkout_items WHERE checkout_id = ? AND line_id = ?',
      [checkout_id, checkout_line_id]
    );
    if (!item) throw new Error(`Check-out line item ${checkout_line_id} not found.`);

    const med = await tx.getFirstAsync('SELECT * FROM medications WHERE id = ?', [item.medication_id]);
    if (!med) throw new Error(`Medication ID ${item.medication_id} not found.`);

    const tallies = await getLineItemTallies(tx, checkout_line_id);
    if (qty > tallies.outstanding) {
      throw new Error(
        `Over-reconciliation rejected. Attempting to account for ${qty} ${item.stock_unit}, but only ${tallies.outstanding} ${item.stock_unit} remains outstanding.`
      );
    }

    const event_type = type === 'consumption' ? 'consumption' : 'waste_loss';
    const disposition = type === 'consumption' ? 'consumed' : (type === 'waste' ? 'wasted' : type);

    const event_id = generateId('evt_rec');
    await tx.runAsync(
      `INSERT INTO inventory_events (
         event_id, operation_id, event_type, checkout_id, checkout_line_id,
         medication_id, lot_number, stock_unit, quantity, source_location,
         destination_location, person_or_team, disposition, reason, notes, recorded_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event_id,
        operation_id,
        event_type,
        checkout_id,
        checkout_line_id,
        med.id,
        item.lot_number,
        item.stock_unit,
        qty,
        checkout.destination,
        'N/A',
        checkout.person_or_team,
        disposition,
        reason.trim(),
        notes.trim(),
        operator
      ]
    );

    await updateCheckoutStatus(tx, checkout_id);
    return { ok: true };
  });
}

/**
 * Unlinked Return Workflow:
 * Returned medication that cannot be linked to a known checkout.
 * Defaults to quarantine pending review.
 */
export async function processUnlinkedReturn(db, {
  medication_id,
  quantity,
  lot_number = '',
  stock_unit,
  disposition = 'quarantined',
  condition = 'unknown',
  reason,
  location = 'Quarantine Area',
  operator = 'Operator',
  authorization_notes = '',
  operation_id = generateId('op_unlinked'),
}) {
  const qty = Number(quantity);
  if (!qty || qty <= 0 || !Number.isInteger(qty)) throw new Error('Quantity must be positive whole number.');
  if (!reason || !reason.trim()) throw new Error('Reason and authorization explanation required for unlinked return.');

  return await db.withExclusiveTransactionAsync(async (tx) => {
    const med = await tx.getFirstAsync('SELECT * FROM medications WHERE id = ?', [medication_id]);
    if (!med) throw new Error('Medication not found.');

    const unit = stock_unit || med.stock_unit || 'tablets';

    // Quarantine physically
    await tx.runAsync(
      `INSERT INTO quarantine_stock (medication_id, lot_number, stock_unit, quantity, location, condition, reason, received_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quarantined')`,
      [med.id, lot_number || med.lot_number || '', unit, qty, location, condition, `Unlinked: ${reason}`, operator]
    );

    const event_id = generateId('evt_unl');
    await tx.runAsync(
      `INSERT INTO inventory_events (
         event_id, operation_id, event_type, medication_id, lot_number, stock_unit,
         quantity, source_location, destination_location, person_or_team,
         disposition, condition, reason, notes, recorded_by
       ) VALUES (?, ?, 'unlinked_return', ?, ?, ?, ?, 'External / Unlinked', ?, 'Unlinked Return', 'quarantined', ?, ?, ?, ?)`,
      [
        event_id,
        operation_id,
        med.id,
        lot_number || med.lot_number || '',
        unit,
        qty,
        location,
        condition,
        reason.trim(),
        authorization_notes.trim(),
        operator
      ]
    );

    return { ok: true, event_id };
  });
}

/**
 * Audit Trail Reversal / Correction:
 * Preserves append-only history with a linked reversal event.
 */
export async function processReversal(db, {
  target_event_id,
  reason,
  operator = 'Operator',
  operation_id = generateId('op_rev'),
}) {
  if (!reason || !reason.trim()) throw new Error('A detailed reason is required to perform an audit reversal.');

  return await db.withExclusiveTransactionAsync(async (tx) => {
    const target = await tx.getFirstAsync('SELECT * FROM inventory_events WHERE event_id = ?', [target_event_id]);
    if (!target) throw new Error(`Event ${target_event_id} not found.`);

    if (target.event_type === 'correction_reversal') {
      throw new Error('Cannot reverse an event that is already a reversal.');
    }

    // Check if target was already reversed
    const alreadyRev = await tx.getFirstAsync(
      "SELECT event_id FROM inventory_events WHERE parent_event_id = ? AND event_type = 'correction_reversal'",
      [target_event_id]
    );
    if (alreadyRev) throw new Error(`Event ${target_event_id} has already been reversed by ${alreadyRev.event_id}.`);

    const med = await tx.getFirstAsync('SELECT * FROM medications WHERE id = ?', [target.medication_id]);
    if (!med) throw new Error('Medication not found.');

    // Validate reversal impact on inventory & checkouts
    if (target.event_type === 'checkout') {
      // Reversing a checkout line means restoring available stock, BUT only if no returns/consumption depend on it
      const tallies = await getLineItemTallies(tx, target.checkout_line_id);
      if (tallies.returned_usable > 0 || tallies.returned_quarantine > 0 || tallies.consumed > 0 || tallies.wasted_lost > 0) {
        throw new Error(
          `Cannot reverse checkout line ${target.checkout_line_id}: returns or reconciliation events already exist for it. Reverse those events first.`
        );
      }
      // Restore available
      await tx.runAsync('UPDATE medications SET quantity = quantity + ? WHERE id = ?', [target.quantity, med.id]);
    } else if (target.event_type === 'return_usable') {
      // Reversing a usable return requires deducting available stock. Check if sufficient available!
      if (med.quantity < target.quantity) {
        throw new Error(
          `Cannot reverse usable return: available stock is only ${med.quantity} ${med.stock_unit}, cannot deduct ${target.quantity}.`
        );
      }
      await tx.runAsync('UPDATE medications SET quantity = quantity - ? WHERE id = ?', [target.quantity, med.id]);
    } else if (target.event_type === 'return_quarantine') {
      // Reversing quarantined return: reduce quarantine stock
      await tx.runAsync(
        `UPDATE quarantine_stock SET quantity = quantity - ? WHERE checkout_id = ? AND medication_id = ? AND status = 'quarantined' AND quantity >= ?`,
        [target.quantity, target.checkout_id, med.id, target.quantity]
      );
    }

    const rev_id = generateId('evt_rev');
    await tx.runAsync(
      `INSERT INTO inventory_events (
         event_id, operation_id, event_type, checkout_id, checkout_line_id,
         medication_id, lot_number, stock_unit, quantity, source_location,
         destination_location, person_or_team, disposition, reason, notes,
         recorded_by, parent_event_id
       ) VALUES (?, ?, 'correction_reversal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reversed', ?, ?, ?, ?)`,
      [
        rev_id,
        operation_id,
        target.checkout_id,
        target.checkout_line_id,
        med.id,
        target.lot_number,
        target.stock_unit,
        target.quantity,
        'Correction',
        'Correction',
        target.person_or_team,
        `Reversal of ${target.event_id}: ${reason.trim()}`,
        `Reversal of event ${target.event_id}`,
        operator,
        target.event_id
      ]
    );

    if (target.checkout_id) {
      await updateCheckoutStatus(tx, target.checkout_id);
    }

    return { ok: true, reversal_event_id: rev_id };
  });
}

/**
 * Calculates current tallies for a single line item
 */
export async function getLineItemTallies(db, line_id) {
  const item = await db.getFirstAsync('SELECT * FROM checkout_items WHERE line_id = ?', [line_id]);
  if (!item) return { checked_out: 0, returned_usable: 0, returned_quarantine: 0, consumed: 0, wasted_lost: 0, outstanding: 0 };

  const events = await db.getAllAsync(
    `SELECT event_id, event_type, quantity, parent_event_id FROM inventory_events WHERE checkout_line_id = ?`,
    [line_id]
  );

  // Filter out reversed events
  const reversedIds = new Set(
    events.filter(e => e.event_type === 'correction_reversal' && e.parent_event_id).map(e => e.parent_event_id)
  );

  let returned_usable = 0;
  let returned_quarantine = 0;
  let consumed = 0;
  let wasted_lost = 0;

  for (const e of events) {
    if (reversedIds.has(e.event_id) || e.event_type === 'correction_reversal') continue;
    if (e.event_type === 'return_usable') returned_usable += e.quantity;
    else if (e.event_type === 'return_quarantine') returned_quarantine += e.quantity;
    else if (e.event_type === 'consumption') consumed += e.quantity;
    else if (e.event_type === 'waste_loss') wasted_lost += e.quantity;
  }

  const outstanding = Math.max(0, item.quantity_checked_out - returned_usable - returned_quarantine - consumed - wasted_lost);

  return {
    checked_out: item.quantity_checked_out,
    returned_usable,
    returned_quarantine,
    consumed,
    wasted_lost,
    outstanding,
  };
}

export async function updateCheckoutStatus(db, checkout_id) {
  const lines = await db.getAllAsync('SELECT line_id FROM checkout_items WHERE checkout_id = ?', [checkout_id]);
  let totalCheckedOut = 0;
  let totalOutstanding = 0;

  for (const line of lines) {
    const t = await getLineItemTallies(db, line.line_id);
    totalCheckedOut += t.checked_out;
    totalOutstanding += t.outstanding;
  }

  let status = 'open';
  if (totalOutstanding === 0 && totalCheckedOut > 0) {
    status = 'closed';
  } else if (totalOutstanding < totalCheckedOut) {
    status = 'partially_reconciled';
  }

  await db.runAsync("UPDATE checkouts SET status = ?, updated_at = datetime('now') WHERE checkout_id = ?", [status, checkout_id]);
}

/**
 * Aggregated Inventory Balances & Movement Queries
 */
export async function getInventoryDashboard(db, { startDate, endDate, medicationId, location, personOrTeam } = {}) {
  // 1. Current authoritative balances (Not constrained by period filters)
  const availableRes = await db.getAllAsync(
    `SELECT m.id, m.brand_name, m.generic_name, m.stock_unit, m.location, SUM(m.quantity) as available_qty
     FROM medications m
     ${medicationId ? 'WHERE m.id = ?' : ''}
     GROUP BY m.id, m.stock_unit` + (medicationId ? '' : ''),
    medicationId ? [medicationId] : []
  );

  const quarantineRes = await db.getAllAsync(
    `SELECT q.medication_id, q.stock_unit, SUM(q.quantity) as quarantine_qty
     FROM quarantine_stock q
     WHERE q.status = 'quarantined' ${medicationId ? 'AND q.medication_id = ?' : ''}
     GROUP BY q.medication_id, q.stock_unit`,
    medicationId ? [medicationId] : []
  );

  // 2. Outstanding balance across ALL open checkouts
  const openLines = await db.getAllAsync(
    `SELECT ci.line_id, ci.checkout_id, ci.medication_id, ci.stock_unit, ci.quantity_checked_out, c.expected_return_date, c.person_or_team
     FROM checkout_items ci
     JOIN checkouts c ON ci.checkout_id = c.checkout_id
     WHERE c.status != 'closed' ${medicationId ? 'AND ci.medication_id = ?' : ''} ${personOrTeam ? 'AND c.person_or_team LIKE ?' : ''}`,
    [...(medicationId ? [medicationId] : []), ...(personOrTeam ? [`%${personOrTeam}%`] : [])]
  );

  let totalOutstanding = 0;
  let overdueCheckoutsCount = 0;
  const today = new Date().toISOString().slice(0, 10);
  const outstandingByMed = {};

  const checkedCheckoutOverdue = new Set();
  for (const line of openLines) {
    const t = await getLineItemTallies(db, line.line_id);
    if (t.outstanding > 0) {
      totalOutstanding += t.outstanding;
      outstandingByMed[line.medication_id] = (outstandingByMed[line.medication_id] || 0) + t.outstanding;

      if (line.expected_return_date && line.expected_return_date < today && !checkedCheckoutOverdue.has(line.checkout_id)) {
        overdueCheckoutsCount++;
        checkedCheckoutOverdue.add(line.checkout_id);
      }
    }
  }

  // 3. Movement Activity in the selected period
  let periodWhere = 'WHERE 1=1';
  const periodParams = [];
  if (startDate) {
    periodWhere += ' AND date(event_timestamp) >= date(?)';
    periodParams.push(startDate);
  }
  if (endDate) {
    periodWhere += ' AND date(event_timestamp) <= date(?)';
    periodParams.push(endDate);
  }
  if (medicationId) {
    periodWhere += ' AND medication_id = ?';
    periodParams.push(medicationId);
  }

  const periodEvents = await db.getAllAsync(
    `SELECT event_id, event_type, quantity, stock_unit, parent_event_id
     FROM inventory_events ${periodWhere}`,
    periodParams
  );

  const reversedEventIds = new Set(
    periodEvents.filter(e => e.event_type === 'correction_reversal' && e.parent_event_id).map(e => e.parent_event_id)
  );

  let periodCheckedOut = 0;
  let periodUsableReturned = 0;
  let periodQuarantinedReturned = 0;
  let periodConsumed = 0;
  let periodWasted = 0;

  for (const ev of periodEvents) {
    if (reversedEventIds.has(ev.event_id) || ev.event_type === 'correction_reversal') continue;
    if (ev.event_type === 'checkout') periodCheckedOut += ev.quantity;
    else if (ev.event_type === 'return_usable') periodUsableReturned += ev.quantity;
    else if (ev.event_type === 'return_quarantine') periodQuarantinedReturned += ev.quantity;
    else if (ev.event_type === 'consumption') periodConsumed += ev.quantity;
    else if (ev.event_type === 'waste_loss') periodWasted += ev.quantity;
  }

  let totalAvailable = 0;
  availableRes.forEach(r => { totalAvailable += (r.available_qty || 0); });

  let totalQuarantine = 0;
  quarantineRes.forEach(r => { totalQuarantine += (r.quarantine_qty || 0); });

  return {
    current: {
      available: totalAvailable,
      outstanding: totalOutstanding,
      quarantined: totalQuarantine,
      overdue_checkouts: overdueCheckoutsCount,
    },
    period: {
      checked_out: periodCheckedOut,
      usable_returned: periodUsableReturned,
      quarantined_returned: periodQuarantinedReturned,
      consumed: periodConsumed,
      wasted_lost: periodWasted,
    },
    availableByMed: availableRes,
    outstandingByMed,
    quarantineByMed: quarantineRes,
  };
}

export async function listOutstandingCheckouts(db, search = '') {
  const q = `%${search.trim()}%`;
  const rows = await db.getAllAsync(
    `SELECT
       c.checkout_id,
       c.person_or_team,
       c.destination,
       c.expected_return_date,
       c.status,
       c.created_at,
       ci.line_id,
       ci.medication_id,
       ci.lot_number,
       ci.stock_unit,
       ci.quantity_checked_out,
       ci.source_location,
       m.brand_name,
       m.generic_name,
       m.strength,
       m.ndc,
       m.barcode
     FROM checkouts c
     JOIN checkout_items ci ON c.checkout_id = ci.checkout_id
     JOIN medications m ON ci.medication_id = m.id
     WHERE c.status != 'closed'
       AND (c.checkout_id LIKE ? OR c.person_or_team LIKE ? OR m.brand_name LIKE ? OR m.generic_name LIKE ? OR m.ndc LIKE ? OR m.barcode LIKE ? OR ci.lot_number LIKE ?)
     ORDER BY c.created_at DESC`,
    [q, q, q, q, q, q, q]
  );

  const today = new Date().toISOString().slice(0, 10);
  const result = [];

  for (const r of rows) {
    const tallies = await getLineItemTallies(db, r.line_id);
    if (tallies.outstanding > 0) {
      result.push({
        ...r,
        ...tallies,
        is_overdue: Boolean(r.expected_return_date && r.expected_return_date < today),
      });
    }
  }

  return result;
}

export async function listInventoryEvents(db, { limit = 100, medicationId, checkoutId, eventType } = {}) {
  let where = 'WHERE 1=1';
  const params = [];
  if (medicationId) {
    where += ' AND e.medication_id = ?';
    params.push(medicationId);
  }
  if (checkoutId) {
    where += ' AND e.checkout_id = ?';
    params.push(checkoutId);
  }
  if (eventType) {
    where += ' AND e.event_type = ?';
    params.push(eventType);
  }

  return await db.getAllAsync(
    `SELECT e.*, m.brand_name, m.generic_name, m.strength, m.ndc
     FROM inventory_events e
     LEFT JOIN medications m ON e.medication_id = m.id
     ${where}
     ORDER BY e.id DESC
     LIMIT ?`,
    [...params, limit]
  );
}
