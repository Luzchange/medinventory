import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, ScrollView } from 'react-native';
import { listMedications, updateMedication, deleteMedication } from '../db';
import { exportInventoryBalancesCsv } from '../csv';
import { c } from '../theme';

function expiryStatus(d) {
  if (!d) return { label: 'No expiry', color: c.mute };
  const days = Math.floor((new Date(d + 'T00:00:00') - new Date()) / 86400000);
  if (isNaN(days)) return { label: d, color: c.mute };
  if (days < 0) return { label: `Expired ${d}`, color: c.danger };
  if (days <= 90) return { label: `Expires ${d} (${days}d)`, color: c.warn };
  return { label: `Expires ${d}`, color: c.ok };
}

export default function InventoryScreen({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);

  const load = useCallback(async () => setRows(await listMedications(q)), [q]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const doExport = async () => {
    try { await exportInventoryBalancesCsv(); } catch (e) { Alert.alert('Export failed', e.message); }
  };

  const saveEdit = async () => {
    await updateMedication(edit.id, edit);
    setEdit(null);
    load();
  };

  const remove = () => Alert.alert('Delete', 'Remove this medication?', [
    { text: 'Cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: async () => {
        try {
          await deleteMedication(edit.id);
          setEdit(null);
          load();
        } catch (e) {
          Alert.alert('Cannot Delete', e.message);
        }
      }
    },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={s.bar}>
        <TextInput
          style={s.search}
          placeholder="Search name, NDC, lot, location, barcode"
          value={q}
          onChangeText={setQ}
        />
        <TouchableOpacity style={s.export} onPress={doExport}>
          <Text style={s.exportT}>Export CSV</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Text style={s.empty}>No medications yet. Scan or add one to get started.</Text>}
        renderItem={({ item }) => {
          const st = expiryStatus(item.expiry_date);
          return (
            <TouchableOpacity style={s.card} onPress={() => setEdit({ ...item, quantity: String(item.quantity) })}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{item.brand_name || item.generic_name || item.ndc}</Text>
                <Text style={s.sub}>{item.strength}</Text>
                <Text style={s.sub}>NDC: {item.ndc}{item.location ? ` · Loc: ${item.location}` : ''}</Text>
                <Text style={s.sub}>Lot: {item.lot_number || 'N/A'}</Text>
                <Text style={{ color: st.color, marginTop: 2, fontSize: 12 }}>{st.label}</Text>
              </View>
              <View style={s.qtyBox}>
                <Text style={s.qty}>{item.quantity}</Text>
                <Text style={s.qtyUnit}>{item.stock_unit || 'tablets'}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <Modal visible={!!edit} animationType="slide" onRequestClose={() => setEdit(null)}>
        {edit && (
          <ScrollView style={{ flex: 1, padding: 16, backgroundColor: c.bg }} keyboardShouldPersistTaps="handled">
            <Text style={s.name}>{edit.brand_name || edit.generic_name || edit.ndc}</Text>
            {[
              ['quantity', 'Physical Quantity Available', 'numeric'],
              ['stock_unit', 'Stock Unit (tablets, vials, mL, etc.)'],
              ['lot_number', 'Lot number'],
              ['expiry_date', 'Expiry (YYYY-MM-DD)'],
              ['location', 'Storage Location'],
              ['notes', 'Notes']
            ].map(([k, l, kb]) => (
              <View key={k}>
                <Text style={s.label}>{l}</Text>
                <TextInput
                  style={s.input}
                  value={edit[k] ?? ''}
                  keyboardType={kb || 'default'}
                  onChangeText={v => setEdit({ ...edit, [k]: v })}
                />
              </View>
            ))}
            <TouchableOpacity style={s.btn} onPress={saveEdit}><Text style={s.btnT}>Save Changes</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: c.danger }]} onPress={remove}><Text style={s.btnT}>Delete</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: c.mute }]} onPress={() => setEdit(null)}><Text style={s.btnT}>Close</Text></TouchableOpacity>
          </ScrollView>
        )}
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', padding: 12, alignItems: 'center' },
  search: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10 },
  export: { marginLeft: 8, backgroundColor: c.primary, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 8 },
  exportT: { color: '#fff', fontWeight: '600' },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.line, alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: c.text },
  sub: { color: c.mute, fontSize: 12 },
  qtyBox: { alignItems: 'flex-end', marginLeft: 12 },
  qty: { fontSize: 24, fontWeight: '700', color: c.primary },
  qtyUnit: { fontSize: 11, color: c.mute, fontWeight: '600' },
  empty: { textAlign: 'center', color: c.mute, marginTop: 40 },
  label: { fontSize: 12, color: c.mute, marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10, backgroundColor: '#fff' },
  btn: { backgroundColor: c.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  btnT: { color: '#fff', fontWeight: '600' },
});
