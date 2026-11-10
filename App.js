import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ScannerScreen from './src/screens/ScannerScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import { c } from './src/theme';

export default function App() {
  const [tab, setTab] = useState('scan');
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.primary }}>
        <StatusBar style="light" />
        <View style={s.header}><Text style={s.h}>MedInventory</Text></View>
        <View style={{ flex: 1 }}>
          {tab === 'scan'
            ? <ScannerScreen onSaved={() => { setRefreshKey(k => k + 1); setTab('inv'); }} />
            : <InventoryScreen refreshKey={refreshKey} />}
        </View>
        <View style={s.tabs}>
          {[['scan', 'Scan'], ['inv', 'Inventory']].map(([k, l]) => (
            <TouchableOpacity key={k} style={s.tab} onPress={() => setTab(k)}>
              <Text style={[s.tabT, tab === k && { color: c.primary, fontWeight: '700' }]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  header: { padding: 14, backgroundColor: c.primary },
  h: { color: '#fff', fontSize: 18, fontWeight: '700' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: c.line },
  tab: { flex: 1, alignItems: 'center', padding: 14 },
  tabT: { color: c.mute },
});
