// SYNC: menu-next/src/lib/orderLabel.ts must be kept byte-for-byte identical to this file.
// Edit both files together whenever this function changes.

export function orderLabel(o: {
  tab_id?: string | null;
  tab_number?: number | null;
  table_number?: number | null;
}): string {
  if (o.tab_id && o.tab_number != null) return `Tab ${o.tab_number}`;
  if (o.table_number != null)           return `Table ${o.table_number}`;
  return 'Quick order';
}
