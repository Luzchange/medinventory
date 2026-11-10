import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { getDb, listMedications } from '../db';
import { processCheckout, generateId } from '../ledger';
import { c } from '../theme';

export default function CheckoutScreen({ onCompleted, onCancel }) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [meds, setMeds] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedMed, setSelectedMed] = useState(null);

  // Form states
  const [quantity, setQuantity] = useState('');
  const [personOrTeam, setPersonOrTeam] = useState('');
  const [destination, setDestination] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');
  const [notes, setNotes] = useState('');
  const [operator, setOperator] = useState('Staff Nurse / Tech');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const rows = await listMedications(search);
        // Only show items with available quantity > 0
        setMeds(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, [search]);

  const handleConfirmCheckout = async () => {
    if (!selectedMed) {
      Alert.alert('Required', 'Please select a medication to check out.');
      return;
    }
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid positive whole number.');
      return;
    }
    if (qty > selectedMed.quantity) {
      Alert.alert('Overdraw Prevented', `Cannot check out ${qty} ${selectedMed.stock_unit}. Available stock is only ${selectedMed.quantity} ${selectedMed.stock_unit}.`);
      return;
    }
    if (!personOrTeam.trim()) {
      Alert.alert('Required', 'Please specify the person or clinical team receiving this medication.');
      return;
    }

    Alert.alert(
      'Confirm Check-Out',
      `Check out ${qty} ${selectedMed.stock_unit} of ${selectedMed.brand_name || selectedMed.generic_name} to ${personOrTeam}?\n\nAvailable stock will decrease from ${selectedMed.quantity} to ${selectedMed.quantity - qty} ${selectedMed.stock_unit}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Check-Out',
          onPress: async () => {
            if (submitting) return;
            setSubmitting(true);
            try {
              const db = await getDb();
              const result = await processCheckout(db, {
                items: [{
                  medication_id: selectedMed.id,
                  quantity: qty,
                  lot_number: selectedMed.lot_number,
                  source_location: selectedMed.location,
                }],
                person_or_team: personOrTeam,
                destination,
                expected_return_date: expectedReturnDate,
                notes,
                operator,
                operation_id: generateId('op_co'),
              });

              Alert.alert('Check-Out Success', `Check-Out ID: ${result.checkout_id}\nInventory updated atomically.`);
              onCompleted && onCompleted();
            } catch (e) {
              Alert.alert('Check-Out Failed', e.message);
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
        <Text style={s.title}>Medication Check-Out</Text>
        <TouchableOpacity style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelBtnT}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {/* Medication Selection */}
      <Text style={s.sectionHeader}>1. Select Medication & Lot</Text>
      <TextInput
        style={s.input}
        placeholder="Search by name, NDC, lot, or barcode..."
        value={search}
        onChangeText={setSearch}
      />

      {loading ? (
        <ActivityIndicator style={{ marginVertical: 10 }} />
      ) : (
        <View style={s.medList}>
          {meds.slice(0, 5).map(m => {
            const isSelected = selectedMed && selectedMed.id === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[s.medCard, isSelected && s.medCardSelected]}
                onPress={() => setSelectedMed(m)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.medName, isSelected && { color: c.primary }]}>{m.brand_name || m.generic_name || m.ndc}</Text>
                  <Text style={s.medSub}>{m.strength} · Lot: {m.lot_number || 'N/A'}</Text>
                  <Text style={s.medSub}>Loc: {m.location || 'General'} · Exp: {m.expiry_date || 'N/A'}</Text>
                </View>
                <View style={s.stockTag}>
                  <Text style={s.stockTagNum}>{m.quantity}</Text>
                  <Text style={s.stockTagUnit}>{m.stock_unit || 'tablets'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {selectedMed && (
        <View style={s.selectedBanner}>
          <Text style={s.selectedBannerT}>
            Selected: <Text style={{ fontWeight: '700' }}>{selectedMed.brand_name || selectedMed.generic_name}</Text>
            {'\n'}Available: <Text style={{ fontWeight: '700', color: c.ok }}>{selectedMed.quantity} {selectedMed.stock_unit}</Text>
          </Text>
        </View>
      )}

      {/* Quantity & Units */}
      <Text style={s.sectionHeader}>2. Check-Out Quantity</Text>
      <View style={s.qtyRow}>
        <TextInput
          style={[s.input, { flex: 1, fontSize: 18, fontWeight: '700' }]}
          placeholder="0"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
        />
        <View style={s.unitBadge}>
          <Text style={s.unitBadgeT}>{selectedMed ? selectedMed.stock_unit : 'Unit'}</Text>
        </View>
      </View>

      {/* Accountability Details */}
      <Text style={s.sectionHeader}>3. Accountability & Destination</Text>
      <Text style={s.label}>Receiving Person or Team *</Text>
      <TextInput
        style={s.input}
        placeholder="e.g. ICU Night Team, Dr. Smith, Rapid Response"
        value={personOrTeam}
        onChangeText={setPersonOrTeam}
      />

      <Text style={s.label}>Destination or Purpose</Text>
      <TextInput
        style={s.input}
        placeholder="e.g. Bed 4 Trauma, Outpatient Clinic, Floor 3"
        value={destination}
        onChangeText={setDestination}
      />

      <Text style={s.label}>Expected Return Date (Optional, YYYY-MM-DD)</Text>
      <TextInput
        style={s.input}
        placeholder={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
        value={expectedReturnDate}
        onChangeText={setExpectedReturnDate}
      />

      <Text style={s.label}>Issuing Operator / Authenticated User</Text>
      <TextInput
        style={s.input}
        value={operator}
        onChangeText={setOperator}
      />

      <Text style={s.label}>Notes</Text>
      <TextInput
        style={[s.input, { height: 60 }]}
        placeholder="Specific clinical procedure or shift details..."
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <TouchableOpacity
        style={[s.submitBtn, submitting && { opacity: 0.7 }]}
        onPress={handleConfirmCheckout}
        disabled={submitting}
      >
        <Text style={s.submitBtnT}>{submitting ? 'Processing Atomically...' : 'Confirm Check-Out'}</Text>
      </TouchableOpacity>
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
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: c.text,
  },
  medList: { marginBottom: 8 },
  medCard: {
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
  medCardSelected: { borderColor: c.primary, backgroundColor: '#EBF8FA', borderWidth: 2 },
  medName: { fontSize: 14, fontWeight: '700', color: c.text },
  medSub: { fontSize: 11, color: c.mute, marginTop: 2 },
  stockTag: { alignItems: 'flex-end', marginLeft: 8 },
  stockTagNum: { fontSize: 16, fontWeight: '800', color: c.ok },
  stockTagUnit: { fontSize: 10, color: c.mute },
  selectedBanner: {
    backgroundColor: '#EBF8FA',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: c.primary,
    marginBottom: 10,
  },
  selectedBannerT: { fontSize: 13, color: c.text },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitBadge: { backgroundColor: '#EDF2F7', paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8 },
  unitBadgeT: { fontSize: 14, fontWeight: '700', color: c.text },
  submitBtn: {
    backgroundColor: c.primary,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  submitBtnT: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
