import type { components } from './schema';

type Schemas = components['schemas'];
export type SeasonEvents = Schemas['SeasonEvents'];
export type EventInfo = Schemas['EventInfo'];
export type SessionInfo = Schemas['SessionInfo'];
export type SessionCode = SessionInfo['code'];
export type SessionDetail = Schemas['SessionDetail'];
export type DriverInfo = Schemas['DriverInfo'];
export type Lap = Schemas['Lap'];
export type Comparison = Schemas['Comparison'];
export type ComparedLap = Schemas['ComparedLap'];
export type Circuit = Schemas['Circuit'];
export type CornerSegment = Schemas['CornerSegment'];
export type CornerLap = Schemas['CornerLap'];
export type RaceControlMessage = Schemas['RaceControlMessage'];
export type Weather = Schemas['Weather'];

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
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new ApiError(response.status, detail);
  }
  return response.json() as Promise<T>;
}
