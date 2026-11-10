import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { getDb } from '../db';
import { listOutstandingCheckouts } from '../ledger';
import { exportOutstandingCheckoutsCsv } from '../csv';
import { c } from '../theme';

export default function OutstandingScreen({ onSelectForReturn, refreshKey }) {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const rows = await listOutstandingCheckouts(db, search);
      setList(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search, refreshKey]);

  const handleExport = async () => {
    try {
      await exportOutstandingCheckoutsCsv();
    } catch (e) {
      Alert.alert('Export Note', e.message);
    }
  };

  return (
    <View style={s.container}>
      <View style={s.bar}>
        <TextInput
          style={s.search}
          placeholder="Search team, medication, ID, lot..."
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity style={s.export} onPress={handleExport}>
          <Text style={s.exportT}>Export CSV</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={item => item.line_id}
          contentContainerStyle={{ padding: 12 }}
          ListEmptyComponent={
            <Text style={s.empty}>All check-outs are reconciled! No outstanding medications.</Text>
          }
          renderItem={({ item }) => (
            <View style={[s.card, item.is_overdue && s.cardOverdue]}>
              <View style={{ flex: 1 }}>
                <View style={s.titleRow}>
                  <Text style={s.name}>{item.brand_name || item.generic_name || item.ndc}</Text>
                  {item.is_overdue && (
                    <View style={s.overdueBadge}>
                      <Text style={s.overdueBadgeT}>OVERDUE</Text>
                    </View>
                  )}
                </View>

                <Text style={s.sub}>
                  Check-Out ID: <Text style={{ fontFamily: 'monospace' }}>{item.checkout_id}</Text>
                </Text>
                <Text style={s.sub}>Issued To: <Text style={{ fontWeight: '600', color: c.text }}>{item.person_or_team}</Text></Text>
                <Text style={s.sub}>Dest / Purpose: {item.destination || 'Unspecified'}</Text>
                <Text style={s.sub}>Lot: {item.lot_number || 'N/A'} · Source Loc: {item.source_location || 'N/A'}</Text>
                <Text style={s.sub}>Issued At: {item.created_at}</Text>
                {item.expected_return_date ? (
                  <Text style={[s.sub, item.is_overdue && { color: c.danger, fontWeight: '700' }]}>
                    Expected Return: {item.expected_return_date}
                  </Text>
                ) : null}

                {/* Tallies Breakout */}
                <View style={s.tallyRow}>
                  <Text style={s.tallyItem}>Out: <Text style={{ fontWeight: '700' }}>{item.checked_out}</Text></Text>
                  <Text style={s.tallyItem}>Ret: <Text style={{ fontWeight: '700', color: c.ok }}>{item.returned_usable}</Text></Text>
                  <Text style={s.tallyItem}>Quar: <Text style={{ fontWeight: '700', color: c.warn }}>{item.returned_quarantine}</Text></Text>
                  <Text style={s.tallyItem}>Used: <Text style={{ fontWeight: '700', color: '#3182CE' }}>{item.consumed}</Text></Text>
                  <Text style={s.tallyItem}>Waste: <Text style={{ fontWeight: '700', color: c.danger }}>{item.wasted_lost}</Text></Text>
                </View>
              </View>

              <View style={s.actionCol}>
                <View style={s.qtyBadge}>
                  <Text style={s.qtyNum}>{item.outstanding}</Text>
                  <Text style={s.qtyUnit}>{item.stock_unit}</Text>
                  <Text style={s.qtyStatus}>remaining</Text>
                </View>
                <TouchableOpacity
                  style={s.returnActionBtn}
                  onPress={() => onSelectForReturn && onSelectForReturn(item.checkout_id)}
                >
                  <Text style={s.returnActionBtnT}>Reconcile</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  bar: { flexDirection: 'row', padding: 12, alignItems: 'center' },
  search: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10 },
  export: { marginLeft: 8, backgroundColor: c.primary, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 8 },
  exportT: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: c.mute, marginTop: 40, paddingHorizontal: 20 },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: c.line,
  },
  cardOverdue: { borderColor: c.danger, borderLeftWidth: 4, borderLeftColor: c.danger },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 15, fontWeight: '700', color: c.text },
  overdueBadge: { backgroundColor: '#FED7D7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  overdueBadgeT: { fontSize: 10, fontWeight: '800', color: c.danger },
  sub: { color: c.mute, fontSize: 11, marginTop: 2 },
  tallyRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  tallyItem: { fontSize: 11, color: c.mute, backgroundColor: '#EDF2F7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  actionCol: { alignItems: 'flex-end', justifyContent: 'space-between', marginLeft: 10 },
  qtyBadge: { alignItems: 'center' },
  qtyNum: { fontSize: 22, fontWeight: '800', color: c.warn },
  qtyUnit: { fontSize: 11, fontWeight: '700', color: c.text },
  qtyStatus: { fontSize: 9, color: c.mute },
  returnActionBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 8,
  },
  returnActionBtnT: { color: '#fff', fontWeight: '700', fontSize: 11 },
});
