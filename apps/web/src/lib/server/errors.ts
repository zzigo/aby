import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { log } from './logger';

export class AbyError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'AbyError';
  }
}

export async function jsonBody(event: RequestEvent): Promise<unknown> {
  return event.request.json().catch(() => { throw new AbyError('invalid_json', 'Request body must be valid JSON', 400); });
}

export function ownerFor(event: RequestEvent): string {
  const production = process.env.NODE_ENV === 'production';
  if (production) throw new AbyError('authentication_required', 'Logto session validation is required before production use', 401);
  return event.request.headers.get('x-aby-owner')?.trim() || 'phase-0-local-user';
}

export async function api<T>(operation: string, callback: (traceId: string) => Promise<T>): Promise<Response> {
  const traceId = randomUUID();
  try {
    const body = await callback(traceId);
    return Response.json(body, { headers: { 'x-aby-trace-id': traceId } });
  } catch (error) {
    const known = error instanceof AbyError;
    const status = known ? error.status : 500;
    const code = known ? error.code : 'internal_error';
    log(known ? 'warn' : 'error', operation, { traceId, code, error });
    return Response.json({ error: { code, message: known ? error.message : 'Unexpected server error', traceId } }, {
      status,
      headers: { 'x-aby-trace-id': traceId }
    });
  }
}

