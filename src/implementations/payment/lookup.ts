/**
 * Reads `table` under a key that comes from outside, such as a status
 * Checkout.com reports. Only a key the table has of its own is read, so one it
 * merely inherits, such as `constructor`, finds nothing; the table keeps its
 * literal type where it is declared.
 */
export function LookUp<Value>(
  table: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  return Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
}
