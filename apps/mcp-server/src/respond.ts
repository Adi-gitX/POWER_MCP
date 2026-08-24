/**
 * Turning a `PowerResponse` into an MCP tool result.
 *
 * The payload goes in two places on purpose. `structuredContent` is the typed
 * channel for clients that read it; the text block is the same JSON for the
 * many clients that only show the model `content[0].text`. A model must never
 * see a refusal it cannot read.
 *
 * `isError` is set only for genuine tool failures — a file that does not exist,
 * a command that could not start. Never for a refusal. See `envelope.ts` for
 * why that distinction carries the whole product.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ContextBlock, PowerResponse } from '@power/protocol';

export function toResult(response: PowerResponse<unknown>): CallToolResult {
  const text = JSON.stringify(response, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent: response as unknown as Record<string, unknown>,
  };
}

export function toErrorResult(message: string, context?: ContextBlock): CallToolResult {
  const payload = { ok: false, error: message, billed: false, ...(context ? { context } : {}) };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}
