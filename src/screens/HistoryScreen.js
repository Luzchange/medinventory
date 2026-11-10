import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { getDb } from '../db';
import { listInventoryEvents, processReversal, generateId } from '../ledger';
import { exportMovementHistoryCsv } from '../csv';
import { c } from '../theme';

export default function HistoryScreen({ refreshKey }) {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [reversalReason, setReversalReason] = useState('');

  const loadEvents = async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const list = await listInventoryEvents(db, { limit: 150, eventType: typeFilter || undefined });
      setEvents(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [typeFilter, refreshKey]);

  const [reversalTarget, setReversalTarget] = useState(null);
  const [reversalReasonText, setReversalReasonText] = useState('');
  const [submittingRev, setSubmittingRev] = useState(false);

  const confirmReversalModal = async () => {
    if (!reversalReasonText.trim()) {
      Alert.alert('Required', 'A clinical/administrative reason is required for audit reversal.');
      return;
    }
    setSubmittingRev(true);
    try {
      const db = await getDb();
      await processReversal(db, {
        target_event_id: reversalTarget.event_id,
        reason: reversalReasonText.trim(),
        operator: 'Clinical Auditor',
        operation_id: generateId('op_rev'),
      });
      Alert.alert('Reversal Successful', `Linked reversal event recorded. Event ${reversalTarget.event_id} neutralized.`);
      setReversalTarget(null);
      setReversalReasonText('');
      loadEvents();
    } catch (e) {
      Alert.alert('Reversal Failed', e.message);
    } finally {
      setSubmittingRev(false);
    }
  };

  const handleReversal = (ev) => {
    setReversalTarget(ev);
    setReversalReasonText('');
  };

  const getBadge = (type) => {
    switch (type) {
      case 'checkout': return { bg: '#EBF8FA', color: c.primary, label: 'CHECK OUT' };
      case 'return_usable': return { bg: '#E6FFFA', color: c.ok, label: 'RETURN USABLE' };
      case 'return_quarantine': return { bg: '#FEFCBF', color: '#D69E2E', label: 'QUARANTINE' };
      case 'consumption': return { bg: '#EBF8FF', color: '#3182CE', label: 'CONSUMED' };
      case 'waste_loss': return { bg: '#FED7D7', color: c.danger, label: 'WASTE / LOSS' };
      case 'correction_reversal': return { bg: '#E2E8F0', color: '#4A5568', label: 'REVERSED' };
      default: return { bg: '#EDF2F7', color: c.mute, label: type.toUpperCase() };
    }
  };

  return (
    <View style={s.container}>
      {/* Filter bar */}
      <View style={s.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[
            ['', 'All Movements'],
            ['checkout', 'Check-outs'],
            ['return_usable', 'Usable Returns'],
            ['return_quarantine', 'Quarantined'],
            ['consumption', 'Consumed'],
            ['waste_loss', 'Waste & Loss'],
            ['correction_reversal', 'Reversals'],
          ].map(([t, l]) => (
            <TouchableOpacity
              key={t}
              style={[s.pill, typeFilter === t && s.pillActive]}
              onPress={() => setTypeFilter(t)}
            >
              <Text style={[s.pillT, typeFilter === t && s.pillTActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={s.exportBtn} onPress={() => exportMovementHistoryCsv()}>
          <Text style={s.exportBtnT}>CSV</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={item => item.event_id}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={<Text style={s.empty}>No transaction events recorded yet.</Text>}
          renderItem={({ item }) => {
            const badge = getBadge(item.event_type);
            return (
              <View style={s.card}>
                <View style={s.topRow}>
                  <View style={[s.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[s.badgeT, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                  <Text style={s.time}>{item.event_timestamp}</Text>
                </View>

                <View style={s.midRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.medName}>{item.brand_name || item.generic_name || `Med #${item.medication_id}`}</Text>
                    <Text style={s.sub}>
                      {item.strength} · Lot: {item.lot_number || 'N/A'}
                    </Text>
                    <Text style={s.sub}>
                      Team: {item.person_or_team || 'N/A'} · Loc: {item.destination_location || item.source_location || 'N/A'}
                    </Text>
                    {item.reason ? <Text style={[s.sub, { fontStyle: 'italic' }]}>Note: {item.reason}</Text> : null}
                    <Text style={[s.sub, { fontSize: 10 }]}>By: {item.recorded_by} · OpID: {item.operation_id}</Text>
                  </View>

                  <View style={s.qtyBox}>
                    <Text style={[s.qtyVal, { color: badge.color }]}>{item.quantity}</Text>
                    <Text style={s.qtyUnit}>{item.stock_unit}</Text>
                  </View>
                </View>

                {item.event_type !== 'correction_reversal' && (
                  <TouchableOpacity style={s.revLink} onPress={() => handleReversal(item)}>
                    <Text style={s.revLinkT}>Audit Correction / Reversal ↺</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {/* Modal for Cross-Platform Audit Reversals */}
      <Modal visible={!!reversalTarget} transparent animationType="fade" onRequestClose={() => setReversalTarget(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Audit Correction / Reversal</Text>
            {reversalTarget && (
              <Text style={s.modalSub}>
                Reversing event {reversalTarget.event_id} ({reversalTarget.event_type} - {reversalTarget.quantity} {reversalTarget.stock_unit})
              </Text>
            )}
            <Text style={s.modalLabel}>Reason for Reversal *</Text>
            <TextInput
              style={s.modalInput}
              placeholder="e.g. Data entry error, duplicate scan, test record..."
              value={reversalReasonText}
              onChangeText={setReversalReasonText}
              multiline
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setReversalTarget(null)}>
                <Text style={s.modalCancelT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalCommit, submittingRev && { opacity: 0.7 }]}
                onPress={confirmReversalModal}
                disabled={submittingRev}
              >
                <Text style={s.modalCommitT}>{submittingRev ? 'Processing...' : 'Commit Reversal'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  filterBar: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: c.line, alignItems: 'center' },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#EDF2F7' },
  pillActive: { backgroundColor: c.primary },
  pillT: { fontSize: 11, fontWeight: '600', color: c.text },
  pillTActive: { color: '#fff' },
  exportBtn: { marginLeft: 8, backgroundColor: c.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  exportBtnT: { color: '#fff', fontWeight: '700', fontSize: 11 },
  empty: { textAlign: 'center', color: c.mute, marginTop: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.line,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  badgeT: { fontSize: 10, fontWeight: '800' },
  time: { fontSize: 10, color: c.mute },
  midRow: { flexDirection: 'row', justifyContent: 'space-between' },
  medName: { fontSize: 14, fontWeight: '700', color: c.text },
  sub: { fontSize: 11, color: c.mute, marginTop: 1 },
  qtyBox: { alignItems: 'center', marginLeft: 8 },
  qtyVal: { fontSize: 18, fontWeight: '800' },
  qtyUnit: { fontSize: 10, color: c.mute },
  revLink: { marginTop: 6, alignSelf: 'flex-start' },
  revLinkT: { fontSize: 11, color: c.danger, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalBox: { backgroundColor: '#fff', borderRadius: 12, padding: 18, width: '100%', maxWidth: 420 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: c.text, marginBottom: 4 },
  modalSub: { fontSize: 12, color: c.mute, marginBottom: 12 },
  modalLabel: { fontSize: 12, fontWeight: '600', color: c.text, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10, minHeight: 70, textAlignVertical: 'top', backgroundColor: '#F8FAFC' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  modalCancelT: { color: c.mute, fontWeight: '600' },
  modalCommit: { backgroundColor: c.danger, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  modalCommitT: { color: '#fff', fontWeight: '700' },
});
