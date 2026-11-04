/**
 * Minimal JSON Schema checker for the subset the MCP tool schemas use: type,
 * properties, required, additionalProperties:false, items, enum, minimum,
 * maximum, exclusiveMinimum, minItems, maxItems, minLength, maxLength, pattern.
 * Arguments are checked before any broker code runs.
 */
type Schema = Record<string, unknown>;

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v;

export function schemaErrors(schema: Schema, value: unknown, at = 'arguments', out: string[] = []): string[] {
  if (out.length >= 8) return out;
  const types = schema.type === undefined ? null : ([] as unknown[]).concat(schema.type) as string[];
  if (types) {
    const t = typeOf(value);
    const ok = types.some(x => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { out.push(`${at} must be ${types.join(' or ')}`); return out; }
  }
  if (typeof value === 'number' && !Number.isFinite(value)) { out.push(`${at} must be finite`); return out; }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) out.push(`${at} must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) out.push(`${at} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) out.push(`${at} must be <= ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) out.push(`${at} must be > ${schema.exclusiveMinimum}`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) out.push(`${at} is shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) out.push(`${at} is longer than ${schema.maxLength}`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) out.push(`${at} does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push(`${at} needs at least ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) out.push(`${at} allows at most ${schema.maxItems} items`);
    if (schema.items && typeof schema.items === 'object') value.forEach((v, i) => schemaErrors(schema.items as Schema, v, `${at}[${i}]`, out));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    const obj = value as Record<string, unknown>;
    for (const r of (schema.required ?? []) as string[]) if (!(r in obj)) out.push(`${at}.${r} is required`);
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) schemaErrors(props[k], v, `${at}.${k}`, out);
      else if (schema.additionalProperties === false) out.push(`${at}.${k} is not allowed`);
    }
  }
  return out;
}
