/**
 * Tool argument validation
 *
 * WHY:
 * - A tool called with a wrong argument name or type used to reach its
 *   handler with undefined inputs and fail with an internal error
 *   ("Cannot read properties of undefined", a GraphQL variable error) that
 *   does not say which argument is at fault
 *
 * HOW:
 * - Every call is checked against the inputSchema the tool declares, before
 *   the handler runs: missing required arguments, unknown top-level arguments
 *   and wrong types are all named in one refusal, together with the arguments
 *   the tool accepts. A top-level argument is one the schema lists: a free-form
 *   map is a declared object property (list_issues' filters), never the top
 *   level, so a misspelled argument can never pass as something else
 * - A string that spells a number or a boolean exactly is taken as that value
 *   for a number, integer or boolean argument, as handlers always did; null
 *   for an optional argument means the argument is left out
 */

const JSON_TYPES = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v),
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
  array: v => Array.isArray(v),
  object: v => typeof v === 'object' && v !== null && !Array.isArray(v)
};

const NUMERIC = /^-?\d+(\.\d+)?$/;

function coerce(value, type) {
  if (typeof value !== 'string') return value;
  if ((type === 'number' || type === 'integer') && NUMERIC.test(value.trim())) return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return `${typeof value} ${JSON.stringify(value)}`;
}

function describeType(schema) {
  if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join(' | ');
  if (schema.type === 'array' && schema.items?.type) return `array of ${schema.items.type}`;
  return schema.type || 'any';
}

/** Check one value against a property schema; returns a problem or null. */
function checkValue(path, value, schema) {
  if (schema.type && !JSON_TYPES[schema.type]?.(value)) {
    return `${path} must be ${describeType(schema)}, got ${describeValue(value)}`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${path} must be one of ${describeType(schema)}, got ${describeValue(value)}`;
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}, got ${value}`;
  }
  if (schema.type === 'array' && schema.items) {
    for (const [i, item] of value.entries()) {
      const problem = checkValue(`${path}[${i}]`, item, schema.items);
      if (problem) return problem;
    }
  }
  if (schema.type === 'object' && typeof schema.additionalProperties === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const problem = checkValue(`${path}.${key}`, item, schema.additionalProperties);
      if (problem) return problem;
    }
  }
  return null;
}

/** "itemId (string, required), board ("roadmap" | "customer")" */
export function describeArguments(inputSchema) {
  const properties = inputSchema.properties || {};
  const required = new Set(inputSchema.required || []);
  const names = Object.keys(properties);
  if (names.length === 0) return 'none';
  return names
    .map(name => `${name} (${describeType(properties[name])}${required.has(name) ? ', required' : ''})`)
    .join(', ');
}

/**
 * A hint for an unknown argument: a name that differs only in case, how to get
 * an itemId, or where a board field (capitalized, like Team or Status; every
 * argument is camelCase) goes on a tool that takes a filters map.
 */
function hintFor(name, properties, toolName) {
  const sameName = Object.keys(properties).find(p => p.toLowerCase() === name.toLowerCase());
  if (sameName) return ` (did you mean ${sameName}?)`;
  if (properties.itemId && /^issue(Url|_number|NodeId)$|^(owner|repo)$/.test(name)) {
    return ` (${toolName} takes the itemId of the board item: get_item_by_issue returns it for an issue URL)`;
  }
  if (properties.filters?.type === 'object' && /^[A-Z]/.test(name)) {
    return ` (a field filter goes under filters: {${JSON.stringify(name)}: "..."})`;
  }
  return '';
}

/**
 * Validate a tool call's arguments against the tool's inputSchema.
 * @param {{name: string, inputSchema: object}} tool - The tool definition
 * @param {object} [args] - The call's arguments
 * @returns {{args: object} | {error: string}} - The arguments to hand to the
 *   handler (with string spellings of numbers and booleans converted and null
 *   optionals dropped), or the refusal naming every problem
 */
export function validateToolArguments(tool, args) {
  const schema = tool.inputSchema || {};
  const properties = schema.properties || {};
  const required = schema.required || [];
  const problems = [];

  if (args !== undefined && args !== null && !JSON_TYPES.object(args)) {
    return { error: `${tool.name}: the arguments must be an object, got ${describeValue(args)}. Accepted arguments: ${describeArguments(schema)}.` };
  }
  const given = args || {};
  const result = {};

  const missing = required.filter(name => given[name] === undefined || given[name] === null);
  for (const name of missing) {
    problems.push(`missing required argument: ${name}`);
  }

  for (const [name, raw] of Object.entries(given)) {
    if (raw === undefined || (raw === null && !required.includes(name))) continue;
    const propSchema = properties[name];
    if (!propSchema) {
      problems.push(`unknown argument: ${name}${hintFor(name, properties, tool.name)}`);
      continue;
    }
    if (raw === null) continue; // a null required argument is already named as missing
    const value = coerce(raw, propSchema.type);
    const problem = checkValue(name, value, propSchema);
    if (problem) {
      problems.push(problem);
      continue;
    }
    result[name] = value;
  }

  if (problems.length > 0) {
    return { error: `${tool.name}: ${problems.join('; ')}. Accepted arguments: ${describeArguments(schema)}.` };
  }
  return { args: result };
}
