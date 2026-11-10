import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ScannerScreen from './src/screens/ScannerScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import CheckoutScreen from './src/screens/CheckoutScreen';
import ReturnScreen from './src/screens/ReturnScreen';
import OutstandingScreen from './src/screens/OutstandingScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import { c } from './src/theme';

export default function App() {
  const [tab, setTab] = useState('dash'); // 'dash', 'inv', 'checkout', 'return', 'outstanding', 'history', 'scan'
  const [selectedCheckoutForReturn, setSelectedCheckoutForReturn] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = () => setRefreshKey(k => k + 1);

  const navigateToReturnWithCheckout = (checkoutId) => {
    setSelectedCheckoutForReturn(checkoutId);
    setTab('return');
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.primary }}>
        <StatusBar style="light" />

        {/* Top Header */}
        <View style={s.header}>
          <Text style={s.h}>MedInventory</Text>
          <View style={s.headerSubRow}>
            <Text style={s.headerSubtitle}>Clinical Drug Inventory & Chain of Custody</Text>
          </View>
        </View>

        {/* Screen View */}
        <View style={{ flex: 1 }}>
          {tab === 'dash' && (
            <DashboardScreen
              onNavigate={(destination) => setTab(destination)}
              refreshKey={refreshKey}
            />
          )}

          {tab === 'inv' && (
            <InventoryScreen
              refreshKey={refreshKey}
            />
          )}

          {tab === 'checkout' && (
            <CheckoutScreen
              onCompleted={() => {
                triggerRefresh();
                setTab('outstanding');
              }}
              onCancel={() => setTab('dash')}
            />
          )}

          {tab === 'return' && (
            <ReturnScreen
              preselectedCheckoutId={selectedCheckoutForReturn}
              onCompleted={() => {
                triggerRefresh();
                setSelectedCheckoutForReturn(null);
                setTab('outstanding');
              }}
              onCancel={() => {
                setSelectedCheckoutForReturn(null);
                setTab('dash');
              }}
            />
          )}

          {tab === 'outstanding' && (
            <OutstandingScreen
              onSelectForReturn={navigateToReturnWithCheckout}
              refreshKey={refreshKey}
            />
          )}

          {tab === 'history' && (
            <HistoryScreen
              refreshKey={refreshKey}
            />
          )}

          {tab === 'scan' && (
            <ScannerScreen
              onSaved={() => {
                triggerRefresh();
                setTab('inv');
              }}
            />
          )}
        </View>

        {/* Floating Bottom Navigation Bar */}
        <View style={s.floatingContainer}>
          <View style={s.floatingBar}>
            {[
              { id: 'dash', icon: '📊', label: 'Hub' },
              { id: 'checkout', icon: '⬆️', label: 'Out' },
              { id: 'return', icon: '↩️', label: 'Return' },
              { id: 'outstanding', icon: '📋', label: 'Outst.' },
              { id: 'inv', icon: '📦', label: 'Stock' },
              { id: 'history', icon: '📜', label: 'Ledger' },
              { id: 'scan', icon: '📷', label: 'Scan', highlight: true },
            ].map(tabItem => {
              const isActive = tab === tabItem.id;
              return (
                <TouchableOpacity
                  key={tabItem.id}
                  style={[s.tabButton, isActive && s.tabButtonActive, tabItem.highlight && s.tabHighlight]}
                  onPress={() => setTab(tabItem.id)}
                  activeOpacity={0.7}
                >
                  <View style={[s.iconCircle, isActive && s.iconCircleActive, tabItem.highlight && s.highlightCircle]}>
                    <Text style={[s.tabEmoji, isActive && s.tabEmojiActive]}>{tabItem.icon}</Text>
                  </View>
                  <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{tabItem.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, backgroundColor: c.primary, elevation: 4 },
  h: { color: '#fff', fontSize: 19, fontWeight: '800', letterSpacing: 0.3 },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  headerSubtitle: { color: '#EBF8FA', fontSize: 11, fontWeight: '500' },
  floatingContainer: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  floatingBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    minWidth: 46,
    borderRadius: 16,
  },
  tabButtonActive: {
    backgroundColor: '#F0F9FF',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleActive: {
    backgroundColor: '#E0F2FE',
  },
  tabHighlight: {
    // slightly highlighted style for scan
  },
  highlightCircle: {
    backgroundColor: '#EBF8FA',
  },
  tabEmoji: {
    fontSize: 18,
  },
  tabEmojiActive: {
    transform: [{ scale: 1.15 }],
  },
  tabLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  tabLabelActive: {
    color: c.primary,
    fontWeight: '800',
  },
});
