export function fmtNaira(amount: number): string {
  return '₦' + amount.toLocaleString('en-NG');
}
