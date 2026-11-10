import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { getDb } from '../db';
import { getInventoryDashboard } from '../ledger';
import { exportMovementHistoryCsv, exportOutstandingCheckoutsCsv, exportInventoryBalancesCsv } from '../csv';
import { c } from '../theme';

export default function DashboardScreen({ onNavigate, refreshKey }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({
    current: { available: 0, outstanding: 0, quarantined: 0, overdue_checkouts: 0 },
    period: { checked_out: 0, usable_returned: 0, quarantined_returned: 0, consumed: 0, wasted_lost: 0 },
    availableByMed: [],
  });
  const [periodDays, setPeriodDays] = useState(30);

  const loadData = async () => {
    setLoading(true);
    try {
      const db = await getDb();
      const startDate = new Date(Date.now() - periodDays * 86400000).toISOString().slice(0, 10);
      const dash = await getInventoryDashboard(db, { startDate });
      setData(dash);
    } catch (e) {
      console.warn('Failed to load dashboard:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshKey, periodDays]);

  const handleExport = async (type) => {
    try {
      if (type === 'history') await exportMovementHistoryCsv();
      else if (type === 'outstanding') await exportOutstandingCheckoutsCsv();
      else await exportInventoryBalancesCsv();
    } catch (e) {
      alert(`Export note: ${e.message}`);
    }
  };

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={{ padding: 14 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadData} />}
    >
      {/* Quick Action Navigation Bar */}
      <View style={s.actionsRow}>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: c.primary }]} onPress={() => onNavigate('checkout')}>
          <Text style={s.actionBtnT}>+ Check Out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: c.ok }]} onPress={() => onNavigate('return')}>
          <Text style={s.actionBtnT}>↩ Return / Account</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#4A5568' }]} onPress={() => onNavigate('outstanding')}>
          <Text style={s.actionBtnT}>📋 Outstanding</Text>
        </TouchableOpacity>
      </View>

      {/* Balance Cards: Live Authoritative Balances */}
      <Text style={s.sectionTitle}>Current Stock Balances</Text>
      <View style={s.grid}>
        <View style={[s.metricCard, { borderLeftColor: c.ok }]}>
          <Text style={s.metricLabel}>Available Stock</Text>
          <Text style={[s.metricValue, { color: c.ok }]}>{data.current.available}</Text>
          <Text style={s.metricSub}>Physically on-hand & ready for use</Text>
        </View>

        <View style={[s.metricCard, { borderLeftColor: c.warn }]}>
          <Text style={s.metricLabel}>Outstanding</Text>
          <Text style={[s.metricValue, { color: c.warn }]}>{data.current.outstanding}</Text>
          <Text style={s.metricSub}>Checked out, not yet returned/accounted</Text>
        </View>

        <View style={[s.metricCard, { borderLeftColor: c.danger }]}>
          <Text style={s.metricLabel}>Quarantined</Text>
          <Text style={[s.metricValue, { color: c.danger }]}>{data.current.quarantined}</Text>
          <Text style={s.metricSub}>Under review / non-dispensable</Text>
        </View>

        <View style={[s.metricCard, { borderLeftColor: data.current.overdue_checkouts > 0 ? c.danger : c.mute }]}>
          <Text style={s.metricLabel}>Overdue Check-outs</Text>
          <Text style={[s.metricValue, { color: data.current.overdue_checkouts > 0 ? c.danger : c.mute }]}>
            {data.current.overdue_checkouts}
          </Text>
          <Text style={s.metricSub}>Past expected return date</Text>
        </View>
      </View>

      {/* Period Activity Tallies */}
      <View style={s.periodHeader}>
        <Text style={s.sectionTitle}>Movement Activity (Past {periodDays} Days)</Text>
        <View style={s.periodPills}>
          {[7, 30, 90].map(days => (
            <TouchableOpacity
              key={days}
              style={[s.pill, periodDays === days && s.pillActive]}
              onPress={() => setPeriodDays(days)}
            >
              <Text style={[s.pillT, periodDays === days && s.pillTActive]}>{days}d</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={s.activityCard}>
        <View style={s.actRow}>
          <Text style={s.actLabel}>Total Checked Out</Text>
          <Text style={[s.actVal, { color: c.primary }]}>{data.period.checked_out}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.actRow}>
          <Text style={s.actLabel}>Usable Returned (Restocked)</Text>
          <Text style={[s.actVal, { color: c.ok }]}>+{data.period.usable_returned}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.actRow}>
          <Text style={s.actLabel}>Quarantined Returns</Text>
          <Text style={[s.actVal, { color: c.warn }]}>{data.period.quarantined_returned}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.actRow}>
          <Text style={s.actLabel}>Confirmed Consumed</Text>
          <Text style={[s.actVal, { color: '#3182CE' }]}>{data.period.consumed}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.actRow}>
          <Text style={s.actLabel}>Wasted / Damaged / Lost</Text>
          <Text style={[s.actVal, { color: c.danger }]}>{data.period.wasted_lost}</Text>
        </View>
      </View>

      {/* Export Section */}
      <Text style={s.sectionTitle}>Audit Reports & CSV Exports</Text>
      <View style={s.exportGrid}>
        <TouchableOpacity style={s.exportBtn} onPress={() => handleExport('balances')}>
          <Text style={s.exportBtnT}>📄 Export Stock Balances</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.exportBtn} onPress={() => handleExport('outstanding')}>
          <Text style={s.exportBtnT}>📋 Export Outstanding Check-outs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.exportBtn} onPress={() => handleExport('history')}>
          <Text style={s.exportBtnT}>📜 Export Movement Ledger</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  actionBtnT: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  metricCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: c.line,
    borderLeftWidth: 4,
  },
  metricLabel: { fontSize: 12, color: c.mute, fontWeight: '600' },
  metricValue: { fontSize: 24, fontWeight: '800', marginVertical: 4 },
  metricSub: { fontSize: 10, color: c.mute },
  periodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 8 },
  periodPills: { flexDirection: 'row', gap: 6 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: '#EDF2F7' },
  pillActive: { backgroundColor: c.primary },
  pillT: { fontSize: 11, color: c.text, fontWeight: '600' },
  pillTActive: { color: '#fff' },
  activityCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.line,
    padding: 14,
    marginBottom: 16,
  },
  actRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  actLabel: { fontSize: 13, color: c.text },
  actVal: { fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 4 },
  exportGrid: { gap: 8, marginBottom: 30 },
  exportBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  exportBtnT: { fontSize: 13, fontWeight: '600', color: c.primary },
});
