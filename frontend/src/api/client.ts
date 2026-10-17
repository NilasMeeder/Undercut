import type { components } from './schema';

export type SeasonEvents = components['schemas']['SeasonEvents'];
export type EventInfo = components['schemas']['EventInfo'];
export type SessionInfo = components['schemas']['SessionInfo'];
export type SessionCode = SessionInfo['code'];

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(response.status, body?.detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
}
