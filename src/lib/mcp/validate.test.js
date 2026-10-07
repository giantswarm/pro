import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { tools } from './tools.js';
import { createMCPServer } from './server.js';
import { validateToolArguments, describeArguments } from './validate.js';

/** A valid value for a property schema. */
function sample(schema) {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'string': return 'x';
    case 'number': case 'integer': return 1;
    case 'boolean': return true;
    case 'array': return [sample(schema.items || { type: 'string' })];
    case 'object': return {};
    default: return 'x';
  }
}

/** A value of the wrong type for a property schema (not coercible to it). */
function wrongType(schema) {
  return schema.type === 'string' || schema.enum ? 42 : { not: 'right' };
}

function validArgs(tool) {
  const { properties = {}, required = [] } = tool.inputSchema;
  return Object.fromEntries(required.map(name => [name, sample(properties[name])]));
}

describe('validateToolArguments, every tool', () => {
  for (const tool of tools) {
    const { properties = {}, required = [] } = tool.inputSchema;
    const accepted = `Accepted arguments: ${describeArguments(tool.inputSchema)}.`;

    describe(tool.name, () => {
      it('passes its required arguments through', () => {
        assert.deepEqual(validateToolArguments(tool, validArgs(tool)), { args: validArgs(tool) });
      });

      for (const name of required) {
        it(`names the missing required argument ${name}`, () => {
          const args = validArgs(tool);
          delete args[name];
          const { error } = validateToolArguments(tool, args);
          assert.equal(error, `${tool.name}: missing required argument: ${name}. ${accepted}`);
        });
      }

      it('names an unknown argument', () => {
        // list_issues takes any extra string argument as a field filter, so its
        // unknown argument has to be of another type to be refused.
        const { error } = validateToolArguments(tool, { ...validArgs(tool), bogusArgument: 1 });
        const expected = tool.inputSchema.additionalProperties
          ? `${tool.name}: bogusArgument must be string, got number 1. ${accepted}`
          : `${tool.name}: unknown argument: bogusArgument. ${accepted}`;
        assert.equal(error, expected);
      });

      const [firstName, firstSchema] = Object.entries(properties)[0];
      it(`names a wrong type for ${firstName}`, () => {
        const value = wrongType(firstSchema);
        const { error } = validateToolArguments(tool, { ...validArgs(tool), [firstName]: value });
        assert.match(error, new RegExp(`^${tool.name}: ${firstName} must be `));
        assert.ok(error.endsWith(accepted), error);
      });
    });
  }
});

describe('validateToolArguments', () => {
  const byName = name => tools.find(t => t.name === name);

  it('names a wrongly spelled argument of update_issue_field with the right spelling', () => {
    const { error } = validateToolArguments(byName('update_issue_field'), { itemId: 'PVTI_1', fieldname: 'Status', value: 'Done' });
    assert.equal(error,
      'update_issue_field: missing required argument: fieldName; unknown argument: fieldname (did you mean fieldName?). ' +
      'Accepted arguments: itemId (string, required), fieldName (string, required), value (string), clear (boolean), board ("roadmap" | "customer").');
  });

  it('points get_issue_details given an issueUrl to get_item_by_issue', () => {
    const { error } = validateToolArguments(byName('get_issue_details'), { issueUrl: 'https://github.com/giantswarm/pro/issues/169' });
    assert.equal(error,
      'get_issue_details: missing required argument: itemId; unknown argument: issueUrl ' +
      '(get_issue_details takes the itemId of the board item: get_item_by_issue returns it for an issue URL). ' +
      'Accepted arguments: itemId (string, required).');
  });

  it('names a value outside an enum', () => {
    const { error } = validateToolArguments(byName('archive_item'), { itemId: 'PVTI_1', board: 'roadmapp' });
    assert.match(error, /^archive_item: board must be one of "roadmap" \| "customer", got string "roadmapp"\./);
  });

  it('names a wrong item type in an array', () => {
    const { error } = validateToolArguments(byName('list_issue_comments'), { itemIds: ['PVTI_1', 7] });
    assert.match(error, /^list_issue_comments: itemIds\[1\] must be string, got number 7\./);
  });

  it('names a value below the minimum', () => {
    const { error } = validateToolArguments(byName('list_issues'), { limit: -1 });
    assert.match(error, /^list_issues: limit must be at least 0, got -1\./);
  });

  it('names a null required argument as missing', () => {
    const { error } = validateToolArguments(byName('get_issue_details'), { itemId: null });
    assert.match(error, /^get_issue_details: missing required argument: itemId\./);
  });

  it('refuses arguments that are not an object', () => {
    const { error } = validateToolArguments(byName('get_issue_details'), ['PVTI_1']);
    assert.match(error, /^get_issue_details: the arguments must be an object, got array\./);
  });

  it('takes string spellings of numbers and booleans and drops null optionals', () => {
    const result = validateToolArguments(byName('get_item_by_issue'), { owner: 'giantswarm', repo: 'pro', issue_number: '169', board: null });
    assert.deepEqual(result, { args: { owner: 'giantswarm', repo: 'pro', issue_number: 169 } });
    const closed = validateToolArguments(byName('close_issue'), { itemId: 'PVTI_1', confirmPublicSafe: 'true' });
    assert.deepEqual(closed, { args: { itemId: 'PVTI_1', confirmPublicSafe: true } });
  });

  it('refuses a fractional integer and a non-numeric string for a number', () => {
    assert.match(validateToolArguments(byName('list_issues'), { limit: 2.5 }).error, /^list_issues: limit must be integer, got number 2\.5\./);
    assert.match(validateToolArguments(byName('get_item_by_issue'), { issue_number: 'one' }).error, /^get_item_by_issue: issue_number must be number, got string "one"\./);
  });

  it('keeps extra string arguments of list_issues as field filters', () => {
    assert.deepEqual(validateToolArguments(byName('list_issues'), { Team: 'Bumblebee', project: 'customer' }),
      { args: { Team: 'Bumblebee', project: 'customer' } });
  });

  it('checks the values of a filters map', () => {
    const { error } = validateToolArguments(byName('list_issues'), { filters: { Team: 3 } });
    assert.match(error, /^list_issues: filters\.Team must be string, got number 3\./);
  });
});

describe('call_tool refuses invalid arguments before the handler runs', () => {
  async function connect() {
    const server = createMCPServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it('update_issue_field with a wrong argument name', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'update_issue_field', arguments: { itemId: 'PVTI_1', field: 'Status', value: 'Done' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^Error: update_issue_field: missing required argument: fieldName; unknown argument: field\. Accepted arguments: /);
    await client.close();
  });

  it('get_issue_details with issueUrl', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'get_issue_details', arguments: { issueUrl: 'giantswarm/pro#169' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /^Error: get_issue_details: missing required argument: itemId; unknown argument: issueUrl /);
    await client.close();
  });
});
