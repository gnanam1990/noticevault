/**
 * @noticevault/db — schema identifier validation
 *
 * Extracted as a separate module to avoid circular imports between
 * pool.ts and migrate.ts.
 */

/**
 * Validate and double-quote a schema identifier for safe interpolation.
 * Only /^[a-z][a-z0-9_]{0,62}$/ accepted. Throws on invalid input.
 */
export function quoteSchema(schema: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error(
      `Invalid schema identifier "${schema}". ` +
      `Must match ^[a-z][a-z0-9_]{0,62}$.`,
    );
  }
  return `"${schema.replace(/"/g, '""')}"`;
}
