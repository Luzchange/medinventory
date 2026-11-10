import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { listMedications } from './db';

const COLUMNS = ['id','ndc','barcode','brand_name','generic_name','strength','dosage_form','route','labeler',
  'package_description','quantity','lot_number','expiry_date','location','notes','created_at','updated_at'];

const esc = v => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;           // neutralize spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => esc(r[c])).join(','))].join('\r\n');
}

export async function exportAndShareCsv() {
  const rows = await listMedications('');
  if (!rows.length) throw new Error('Inventory is empty.');
  const stamp = new Date().toISOString().slice(0, 10);
  const uri = `${FileSystem.cacheDirectory}medication-inventory-${stamp}.csv`;
  await FileSystem.writeAsStringAsync(uri, '\uFEFF' + toCsv(rows), { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export medication inventory', UTI: 'public.comma-separated-values-text' });
  return uri;
}
