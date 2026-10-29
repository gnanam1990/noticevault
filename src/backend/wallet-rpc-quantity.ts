/** Strict JSON-RPC quantities, with explicit compatibility for observed numeric wallet nonces only. */
export function parseWalletQuantity(value: unknown, method: string): bigint {
 const invalid = (): never => { throw Error(method + ' returned an invalid quantity; expected canonical hex' + (method === 'eth_getTransactionCount' ? ' or an exact nonnegative safe-integer nonce' : '') + ' (type ' + (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value) + ')'); };
 let parsed: bigint;
 if (method === 'eth_getTransactionCount' && typeof value === 'number') {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) return invalid();
  parsed = BigInt(value);
 } else {
  if (typeof value !== 'string' || value.length > 66 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) return invalid();
  parsed = BigInt(value);
 }
 const maximum = method === 'eth_getTransactionCount' ? (1n << 64n) - 1n : (1n << 256n) - 1n;
 if (parsed > maximum) return invalid();
 return parsed;
}
