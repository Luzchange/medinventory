import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { getDb } from '../db';
import { listOutstandingCheckouts, processReturn, processReconciliation, generateId } from '../ledger';
import { c } from '../theme';

export default function ReturnScreen({ onCompleted, onCancel, preselectedCheckoutId }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState(preselectedCheckoutId || '');
  const [outstandingList, setOutstandingList] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);

  // Return vs Reconcile Tab
  const [mode, setMode] = useState('return'); // 'return' | 'account'

  // Return fields
  const [returnQty, setReturnQty] = useState('');
  const [disposition, setDisposition] = useState('usable'); // 'usable' | 'quarantined'
  const [condition, setCondition] = useState('intact'); // 'intact' | 'opened' | 'damaged' | 'compromised'
  const [returnReason, setReturnReason] = useState('');
  const [returnLoc, setReturnLoc] = useState('');

  // Account for non-returned fields
  const [reconcileType, setReconcileType] = useState('consumption'); // 'consumption' | 'waste' | 'damaged' | 'lost' | 'other'
  const [reconcileReason, setReconcileReason] = useState('');

  const [operator, setOperator] = useState('Staff Nurse / Lead');

  const loadOutstanding = async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const list = await listOutstandingCheckouts(db, search);
      setOutstandingList(list);
      if (preselectedCheckoutId) {
        const match = list.find(l => l.checkout_id === preselectedCheckoutId);
        if (match) setSelectedItem(match);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOutstanding();
  }, [search]);

  const handleReturnSubmit = async () => {
    if (!selectedItem) {
      Alert.alert('Selection Required', 'Select an outstanding check-out line item.');
      return;
    }
    const qty = parseInt(returnQty, 10);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a positive whole number.');
      return;
    }
    if (qty > selectedItem.outstanding) {
      Alert.alert('Over-Return Prevented', `Cannot return ${qty} ${selectedItem.stock_unit}. Only ${selectedItem.outstanding} ${selectedItem.stock_unit} remains outstanding.`);
      return;
    }

    Alert.alert(
      'Confirm Return',
      `Process return of ${qty} ${selectedItem.stock_unit} as ${disposition.toUpperCase()} (${condition})?\n\n` +
      (disposition === 'usable'
        ? `Will restore +${qty} ${selectedItem.stock_unit} to usable stock.`
        : `Will hold ${qty} ${selectedItem.stock_unit} in Quarantine. Usable stock will NOT increase.`),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Return',
          onPress: async () => {
            if (submitting) return;
            setSubmitting(true);
            try {
              const db = await getDb();
              const res = await processReturn(db, {
                checkout_id: selectedItem.checkout_id,
                checkout_line_id: selectedItem.line_id,
                quantity: qty,
                disposition,
                condition,
                reason: returnReason,
                return_location: returnLoc || selectedItem.source_location,
                operator,
                operation_id: generateId('op_ret'),
              });

              if (res.autoQuarantined) {
                Alert.alert(
                  'Auto-Quarantined',
                  `Notice: Medication was routed to QUARANTINE instead of usable stock.\nReason: ${res.reason}`
                );
              } else {
                Alert.alert('Return Processed', 'Return recorded and ledger balance updated.');
              }
              onCompleted && onCompleted();
            } catch (e) {
              Alert.alert('Return Failed', e.message);
            } finally {
              setSubmitting(false);
            }
          }
        }
      ]
    );
  };

  const handleReconcileSubmit = async () => {
    if (!selectedItem) {
      Alert.alert('Selection Required', 'Select an outstanding check-out line item.');
      return;
    }
    const qty = parseInt(returnQty, 10);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a positive whole number.');
      return;
    }
    if (qty > selectedItem.outstanding) {
      Alert.alert('Over-Reconciliation Prevented', `Cannot reconcile ${qty} ${selectedItem.stock_unit}. Only ${selectedItem.outstanding} ${selectedItem.stock_unit} remains outstanding.`);
      return;
    }
    if (reconcileType !== 'consumption' && !reconcileReason.trim()) {
      Alert.alert('Reason Required', `An explicit reason is required when accounting for ${reconcileType}.`);
      return;
    }

    Alert.alert(
      'Confirm Accountability Record',
      `Record ${qty} ${selectedItem.stock_unit} as ${reconcileType.toUpperCase()}?\n\nThis medication will permanently exit the active supply and reduce outstanding quantity to ${selectedItem.outstanding - qty}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Commit Record',
          onPress: async () => {
            if (submitting) return;
            setSubmitting(true);
            try {
              const db = await getDb();
              await processReconciliation(db, {
                checkout_id: selectedItem.checkout_id,
                checkout_line_id: selectedItem.line_id,
                quantity: qty,
                type: reconcileType,
                reason: reconcileReason,
                operator,
                operation_id: generateId('op_rec'),
              });

              Alert.alert('Reconciliation Recorded', 'Ledger updated successfully.');
              onCompleted && onCompleted();
            } catch (e) {
              Alert.alert('Failed', e.message);
            } finally {
              setSubmitting(false);
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <View style={s.headerRow}>
        <Text style={s.title}>Return & Reconciliation</Text>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelBtnT}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* Select Outstanding Checkout */}
      <Text style={s.sectionHeader}>1. Locate Outstanding Check-Out</Text>
      <TextInput
        style={s.input}
        placeholder="Filter by Check-Out ID, medication, barcode, team..."
        value={search}
        onChangeText={setSearch}
      />

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 10 }} />
      ) : (
        <View style={s.list}>
          {outstandingList.length === 0 ? (
            <Text style={s.emptyT}>No outstanding items matching criteria.</Text>
          ) : (
            outstandingList.slice(0, 5).map(item => {
              const isSelected = selectedItem && selectedItem.line_id === item.line_id;
              return (
                <TouchableOpacity
                  key={item.line_id}
                  style={[s.card, isSelected && s.cardSelected]}
                  onPress={() => {
                    setSelectedItem(item);
                    setReturnQty(String(item.outstanding));
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.name, isSelected && { color: c.primary }]}>
                      {item.brand_name || item.generic_name || item.ndc}
                    </Text>
                    <Text style={s.sub}>
                      ID: <Text style={{ fontFamily: 'monospace' }}>{item.checkout_id}</Text>
                    </Text>
                    <Text style={s.sub}>Team: {item.person_or_team} · Dest: {item.destination || 'N/A'}</Text>
                    <Text style={s.sub}>
                      Checked out: {item.checked_out} | Ret Usable: {item.returned_usable} | Used: {item.consumed}
                    </Text>
                    {item.is_overdue && (
                      <Text style={[s.sub, { color: c.danger, fontWeight: '700' }]}>⚠️ OVERDUE (Exp: {item.expected_return_date})</Text>
                    )}
                  </View>
                  <View style={s.outTag}>
                    <Text style={s.outNum}>{item.outstanding}</Text>
                    <Text style={s.outUnit}>{item.stock_unit} out</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}

      {selectedItem && (
        <>
          {/* Action Mode Toggle */}
          <View style={s.modeToggle}>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'return' && s.modeBtnActive]}
              onPress={() => setMode('return')}
            >
              <Text style={[s.modeBtnT, mode === 'return' && s.modeBtnTActive]}>↩ Physical Return</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeBtn, mode === 'account' && s.modeBtnActive]}
              onPress={() => setMode('account')}
            >
              <Text style={[s.modeBtnT, mode === 'account' && s.modeBtnTActive]}>⚖️ Account for Non-Returned</Text>
            </TouchableOpacity>
          </View>

          {/* Quantity Input */}
          <Text style={s.sectionHeader}>2. Quantity to Process</Text>
          <View style={s.qtyRow}>
            <TextInput
              style={[s.input, { flex: 1, fontSize: 18, fontWeight: '700' }]}
              value={returnQty}
              onChangeText={setReturnQty}
              keyboardType="numeric"
            />
            <View style={s.unitBadge}>
              <Text style={s.unitBadgeT}>{selectedItem.stock_unit}</Text>
            </View>
            <TouchableOpacity
              style={s.fullBtn}
              onPress={() => setReturnQty(String(selectedItem.outstanding))}
            >
              <Text style={s.fullBtnT}>All ({selectedItem.outstanding})</Text>
            </TouchableOpacity>
          </View>

          {mode === 'return' ? (
            /* RETURN FLOW */
            <View>
              <Text style={s.sectionHeader}>3. Return Disposition & Condition</Text>
              <View style={s.pillRow}>
                <TouchableOpacity
                  style={[s.pill, disposition === 'usable' && s.pillOk]}
                  onPress={() => setDisposition('usable')}
                >
                  <Text style={[s.pillT, disposition === 'usable' && s.pillTActive]}>✓ Usable (Restock)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.pill, disposition === 'quarantined' && s.pillWarn]}
                  onPress={() => setDisposition('quarantined')}
                >
                  <Text style={[s.pillT, disposition === 'quarantined' && s.pillTActive]}>⚠️ Quarantine (Review)</Text>
                </TouchableOpacity>
              </View>

              <Text style={s.label}>Container / Package Condition</Text>
              <View style={s.pillRow}>
                {['intact', 'opened', 'damaged', 'compromised'].map(cond => (
                  <TouchableOpacity
                    key={cond}
                    style={[s.pill, condition === cond && s.pillActive]}
                    onPress={() => setCondition(cond)}
                  >
                    <Text style={[s.pillT, condition === cond && s.pillTActive]}>{cond}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>Return Location</Text>
              <TextInput
                style={s.input}
                placeholder={selectedItem.source_location || 'Pharmacy Shelf'}
                value={returnLoc}
                onChangeText={setReturnLoc}
              />

              <Text style={s.label}>Notes / Reason</Text>
              <TextInput
                style={s.input}
                placeholder="Observation or return notes..."
                value={returnReason}
                onChangeText={setReturnReason}
              />

              <TouchableOpacity
                style={[s.submitBtn, { backgroundColor: disposition === 'usable' ? c.ok : c.warn }]}
                onPress={handleReturnSubmit}
                disabled={submitting}
              >
                <Text style={s.submitBtnT}>
                  {submitting ? 'Processing...' : `Confirm ${disposition === 'usable' ? 'Usable Restock' : 'Quarantined Return'}`}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* RECONCILIATION FLOW */
            <View>
              <Text style={s.sectionHeader}>3. Reconciliation Reason</Text>
              <View style={s.pillRow}>
                {[
                  ['consumption', 'Consumed / Administered'],
                  ['waste', 'Wasted'],
                  ['damaged', 'Damaged'],
                  ['lost', 'Lost'],
                  ['other', 'Other']
                ].map(([type, label]) => (
                  <TouchableOpacity
                    key={type}
                    style={[s.pill, reconcileType === type && s.pillActive]}
                    onPress={() => setReconcileType(type)}
                  >
                    <Text style={[s.pillT, reconcileType === type && s.pillTActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>Required Explanation / Clinical Reason *</Text>
              <TextInput
                style={[s.input, { height: 60 }]}
                placeholder="Reason for waste, loss, or consumption details..."
                value={reconcileReason}
                onChangeText={setReconcileReason}
                multiline
              />

              <TouchableOpacity
                style={[s.submitBtn, { backgroundColor: c.danger }]}
                onPress={handleReconcileSubmit}
                disabled={submitting}
              >
                <Text style={s.submitBtnT}>{submitting ? 'Processing...' : 'Commit Non-Returned Record'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: c.text },
  cancelBtn: { padding: 6 },
  cancelBtnT: { color: c.mute, fontWeight: '600' },
  sectionHeader: { fontSize: 14, fontWeight: '700', color: c.primary, marginTop: 14, marginBottom: 6 },
  label: { fontSize: 12, fontWeight: '600', color: c.mute, marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10, fontSize: 14, color: c.text },
  list: { marginBottom: 10 },
  emptyT: { textAlign: 'center', color: c.mute, marginVertical: 14 },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: c.line,
  },
  cardSelected: { borderColor: c.primary, backgroundColor: '#EBF8FA', borderWidth: 2 },
  name: { fontSize: 14, fontWeight: '700', color: c.text },
  sub: { fontSize: 11, color: c.mute, marginTop: 1 },
  outTag: { alignItems: 'flex-end', marginLeft: 8 },
  outNum: { fontSize: 18, fontWeight: '800', color: c.warn },
  outUnit: { fontSize: 10, color: c.mute },
  modeToggle: { flexDirection: 'row', backgroundColor: '#EDF2F7', borderRadius: 8, padding: 3, marginVertical: 10 },
  modeBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 6 },
  modeBtnActive: { backgroundColor: '#fff', elevation: 1 },
  modeBtnT: { fontSize: 13, fontWeight: '600', color: c.mute },
  modeBtnTActive: { color: c.primary, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitBadge: { backgroundColor: '#EDF2F7', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8 },
  unitBadgeT: { fontSize: 14, fontWeight: '700', color: c.text },
  fullBtn: { backgroundColor: '#EDF2F7', paddingHorizontal: 10, paddingVertical: 12, borderRadius: 8 },
  fullBtnT: { fontSize: 12, fontWeight: '700', color: c.primary },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#EDF2F7' },
  pillActive: { backgroundColor: c.primary },
  pillOk: { backgroundColor: c.ok },
  pillWarn: { backgroundColor: c.warn },
  pillT: { fontSize: 12, fontWeight: '600', color: c.text },
  pillTActive: { color: '#fff' },
  submitBtn: { padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 16, marginBottom: 40 },
  submitBtnT: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
