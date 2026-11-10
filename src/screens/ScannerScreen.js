import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, ScrollView, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { lookupByBarcode } from '../ndc';
import { addMedication, findByNdc } from '../db';
import { c } from '../theme';

export default function ScannerScreen({ onSaved }) {
  const [perm, requestPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [drug, setDrug] = useState(null);
  const [form, setForm] = useState({ quantity: '1', lot_number: '', expiry_date: '', location: '', notes: '' });
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState('');
  const locked = useRef(false);

  if (!perm) return <View style={s.center}><ActivityIndicator /></View>;
  if (!perm.granted) {
    return (
      <View style={s.center}>
        <Text style={s.msg}>Camera access is needed to scan medication barcodes.</Text>
        <TouchableOpacity style={s.btn} onPress={requestPerm}><Text style={s.btnT}>Grant permission</Text></TouchableOpacity>
      </View>
    );
  }

  const reset = () => { setDrug(null); locked.current = false; setForm({ quantity: '1', lot_number: '', expiry_date: '', location: '', notes: '' }); };

  const handle = async (code) => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const d = await lookupByBarcode(code);
      if (!d) {
        Alert.alert('Not found', `No FDA NDC match for ${code}. Add it manually?`, [
          { text: 'Rescan', onPress: reset },
          { text: 'Add manually', onPress: () => setDrug({ ndc: code, barcode: code, brand_name: '', generic_name: '', manual: true }) },
        ]);
      } else {
        const existing = await findByNdc(d.ndc);
        if (existing) setForm(f => ({ ...f, lot_number: existing.lot_number, location: existing.location }));
        setDrug(d);
      }
    } catch (e) {
      Alert.alert('Lookup failed', e.message || 'Check your connection.', [{ text: 'OK', onPress: reset }]);
    } finally { setBusy(false); }
  };

  const save = async () => {
    await addMedication({ ...drug, ...form });
    Alert.alert('Saved', `${drug.brand_name || drug.generic_name || drug.ndc} added to inventory.`);
    reset(); onSaved && onSaved();
  };

  if (drug) {
    const set = k => v => setForm(f => ({ ...f, [k]: v }));
    return (
      <ScrollView style={s.page} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          {drug.manual ? (
            <>
              <Text style={s.label}>Brand name</Text>
              <TextInput style={s.input} value={drug.brand_name} onChangeText={v => setDrug({ ...drug, brand_name: v })} />
              <Text style={s.label}>Generic name</Text>
              <TextInput style={s.input} value={drug.generic_name} onChangeText={v => setDrug({ ...drug, generic_name: v })} />
            </>
          ) : (
            <>
              <Text style={s.title}>{drug.brand_name || drug.generic_name}</Text>
              <Text style={s.sub}>{drug.generic_name}</Text>
              <Text style={s.sub}>{drug.strength}</Text>
              <Text style={s.sub}>{drug.dosage_form}{drug.route ? ` · ${drug.route}` : ''}</Text>
              <Text style={s.sub}>{drug.labeler}</Text>
            </>
          )}
          <Text style={s.mono}>NDC {drug.ndc}</Text>
        </View>
        <View style={s.card}>
          {[['quantity','Quantity','numeric'],['lot_number','Lot number'],['expiry_date','Expiry (YYYY-MM-DD)'],['location','Location'],['notes','Notes']].map(([k, l, kb]) => (
            <View key={k}>
              <Text style={s.label}>{l}</Text>
              <TextInput style={s.input} value={form[k]} onChangeText={set(k)} keyboardType={kb || 'default'} />
            </View>
          ))}
        </View>
        <TouchableOpacity style={s.btn} onPress={save}><Text style={s.btnT}>Save to inventory</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, s.ghost]} onPress={reset}><Text style={[s.btnT, { color: c.primary }]}>Cancel</Text></TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['upc_a', 'upc_e', 'ean13', 'ean8', 'code128', 'code39', 'datamatrix', 'qr'] }}
        onBarcodeScanned={busy ? undefined : ({ data }) => handle(data)}
      />
      <View style={s.overlay} pointerEvents="none"><View style={s.frame} /></View>
      {busy && <View style={s.busy}><ActivityIndicator size="large" color="#fff" /><Text style={{ color: '#fff', marginTop: 8 }}>Looking up FDA NDC…</Text></View>}
      <View style={s.bottom}>
        <TouchableOpacity onPress={() => setTorch(t => !t)}><Text style={s.link}>{torch ? 'Torch off' : 'Torch on'}</Text></TouchableOpacity>
        <TextInput style={[s.input, { flex: 1, marginHorizontal: 10, marginBottom: 0 }]} placeholder="Or type barcode / NDC" value={manual}
          onChangeText={setManual} keyboardType="numbers-and-punctuation" />
        <TouchableOpacity onPress={() => manual && handle(manual)}><Text style={s.link}>Look up</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  msg: { textAlign: 'center', marginBottom: 16, color: c.text },
  page: { flex: 1, backgroundColor: c.bg },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.line },
  title: { fontSize: 20, fontWeight: '700', color: c.text },
  sub: { color: c.mute, marginTop: 2 },
  mono: { marginTop: 8, fontFamily: 'monospace', color: c.text },
  label: { fontSize: 12, color: c.mute, marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 10, backgroundColor: '#fff', marginBottom: 4 },
  btn: { backgroundColor: c.primary, padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.primary },
  btnT: { color: '#fff', fontWeight: '600' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '75%', height: 140, borderWidth: 3, borderColor: '#fff', borderRadius: 12 },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: 'rgba(0,0,0,0.65)' },
  link: { color: '#fff', fontWeight: '600' },
});
