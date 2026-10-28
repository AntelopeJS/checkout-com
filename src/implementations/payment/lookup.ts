/**
 * Reads `table` under a key that comes from outside, such as a status
 * Checkout.com reports. The key is read as a plain property, exactly like an
 * index expression, so the table keeps its literal type where it is declared.
 */
export function LookUp<Value>(
  table: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  return table[key];
}
