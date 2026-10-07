/** In-process MCP method payload mapping, not a transport or authenticated MCP server. */
import outcomeSchema from './outcome.schema.json' with { type: 'json' };
export function createMcpMapping({ runtime, actor }) {
  if (!runtime || !actor?.principalId) throw new Error('A runtime and host-bound actor are required');
  const trustedActor = structuredClone(actor);
  const contentUri = (id, kind) => `hoh-content://${encodeURIComponent(id)}/${kind}`;
  return Object.freeze({
    async listResources() {
      const descriptor = await runtime.describe({ actor: trustedActor });
      return { resources: ['descriptor', 'state'].map(kind => ({
        uri: contentUri(descriptor.id, kind), name: `${descriptor.title} · ${kind}`, mimeType: 'application/json'
      })) };
    },
    async readResource(uri) {
      const descriptor = await runtime.describe({ actor: trustedActor });
      let value;
      if (uri === contentUri(descriptor.id, 'descriptor')) value = descriptor;
      else if (uri === contentUri(descriptor.id, 'state')) value = await runtime.read({ actor: trustedActor });
      else throw new Error('Unknown content resource');
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }] };
    },
    async listTools() {
      const descriptor = await runtime.describe({ actor: trustedActor });
      const variants = descriptor.actions.filter(action => !action.gestureRequired && action.effect !== 'external').map(action => ({
        type: 'object', additionalProperties: false,
        required: ['contentId', 'descriptorRevision', 'actionId', 'input', 'expectedStateRevision', 'idempotencyKey'],
        properties: {
          contentId: { const: descriptor.id }, descriptorRevision: { const: descriptor.descriptorRevision },
          actionId: { const: action.id, description: action.description }, input: action.inputSchema,
          expectedStateRevision: { type: 'integer', minimum: 0 }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 }
        }
      }));
      return { tools: variants.length ? [{ name: 'hoh_content_invoke', title: descriptor.title,
        description: 'Invoke a declared content action against the state revision you read. Host permission and confirmation rules still apply.',
        inputSchema: { type: 'object', oneOf: variants },
        outputSchema: { type: 'object', anyOf: [outcomeSchema, { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } }, additionalProperties: false }] },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
      }] : [] };
    },
    async callTool(name, args, { signal } = {}) {
      if (name !== 'hoh_content_invoke') throw new Error('Unknown content tool');
      try {
        const descriptor = await runtime.describe({ actor: trustedActor, signal });
        const action = descriptor.actions.find(row => row.id === args?.actionId);
        if (!action || action.gestureRequired || action.effect === 'external') throw new Error('Action is not exposed to this model');
        // A model cannot self-approve a destructive action or synthesize a user gesture.
        const result = await runtime.invoke(args, { actor: trustedActor, signal });
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
      } catch (error) {
        const failure = { code: typeof error.code === 'string' ? error.code : 'ACTION_REJECTED', message: 'The host did not apply the action.' };
        return { content: [{ type: 'text', text: JSON.stringify(failure) }], structuredContent: failure, isError: true };
      }
    }
  });
}
