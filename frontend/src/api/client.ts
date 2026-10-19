import type { components } from './schema';

type Schemas = components['schemas'];
export type SeasonEvents = Schemas['SeasonEvents'];
export type EventInfo = Schemas['EventInfo'];
export type SessionInfo = Schemas['SessionInfo'];
export type SessionCode = SessionInfo['code'];
export type SessionDetail = Schemas['SessionDetail'];
export type DriverInfo = Schemas['DriverInfo'];
export type Lap = Schemas['Lap'];
export type TrackEvolution = Schemas['TrackEvolution'];
export type Stewarding = Schemas['Stewarding'];
export type Pass = Schemas['Pass'];
export type Incident = Schemas['Incident'];
export type Penalty = Schemas['Penalty'];
export type DeletedLap = Schemas['DeletedLap'];
export type Comparison = Schemas['Comparison'];
export type ComparedLap = Schemas['ComparedLap'];
export type Circuit = Schemas['Circuit'];
export type CornerSegment = Schemas['CornerSegment'];
export type CornerLap = Schemas['CornerLap'];
export type RaceControlMessage = Schemas['RaceControlMessage'];
export type Weather = Schemas['Weather'];
export type SessionTimeline = Schemas['SessionTimeline'];
export type TrackStatus = Schemas['StatusPeriod']['status'];
export type TimingState = Schemas['TimingState'];
export type TowerRow = Schemas['TowerRow'];
export type TowerSector = Schemas['TowerSector'];
export type ReplayStatus = Schemas['ReplayStatus'];
export type ReplayPositions = Schemas['ReplayPositions'];
export type Marker = Schemas['Marker'];
export type MarkerIn = Schemas['MarkerIn'];
export type MarkerKind = Marker['kind'];
export type TagCount = Schemas['TagCount'];
export type View = Schemas['View'];
export type ViewIn = Schemas['ViewIn'];
export type ViewState = Schemas['ViewState-Output'];
export type RaceHistory = Schemas['RaceHistory'];
export type DriverRace = Schemas['DriverRace'];
export type Stint = Schemas['Stint'];
export type PitStop = Schemas['PitStop'];
export type Degradation = Schemas['Degradation'];
export type StintPace = Schemas['StintPace'];
export type CompoundPace = Schemas['CompoundPace'];
export type PitWindow = Schemas['PitWindow'];
export type Duel = Schemas['Duel'];
export type EnergyComparison = Schemas['EnergyComparison'];
export type EnergyLap = Schemas['EnergyLap'];
export type EnergyStraight = Schemas['EnergyStraight'];
export type EnergyStraightLap = Schemas['EnergyStraightLap'];
export type EnergyStraightStats = Schemas['EnergyStraightStats'];
export type EnergySession = Schemas['EnergySession'];
export type TrackZones = Schemas['TrackZones'];
export type TrackSectors = Schemas['TrackSectors'];
export type StraightMode = Schemas['StraightMode'];
export type OvertakeChecks = Schemas['OvertakeChecks'];
export type OvertakeCheck = Schemas['OvertakeCheck'];
export type StraightModeZone = Schemas['StraightModeZone'];
export type TrackZone = Schemas['TrackZone'];
export type DriverEnergy = Schemas['DriverEnergy'];
export type SessionReport = Schemas['SessionReport'];
export type ReportAction = Schemas['ReportAction'];
export type ReportCorner = Schemas['ReportCorner'];
export type ReportRun = Schemas['ReportRun'];
export type ReportStint = Schemas['ReportStint'];
export type ReportClipping = Schemas['ReportClipping'];
export type ReportMoment = Schemas['ReportMoment'];

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const apiPost = <T>(path: string) => apiGet<T>(path, { method: 'POST' });

/** A write with a JSON body (POST/PUT), or a DELETE. */
export function apiSend<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  return apiGet<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
export type LiveSessionInfo = Schemas['LiveSessionInfo'];
export type RecorderStatus = Schemas['RecorderStatus'];
export type ScheduledSession = Schemas['ScheduledSession'];
export type LapProgress = Schemas['LapProgress'];
export type LapPrediction = Schemas['LapPrediction'];
export type CornersProgress = Schemas['CornersProgress'];
export type LiveCorner = Schemas['LiveCorner'];
export type TyreWeekend = Schemas['TyreWeekend'];
export type SetupMap = Schemas['SetupMap'];
export type Teammates = Schemas['Teammates'];
export type WeekendOverview = Schemas['WeekendOverview'];
export type TyreSet = Schemas['TyreSet'];
