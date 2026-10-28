/**
 * RackPower Architect — core domain types.
 *
 * Geometry follows EIA-310-D ("Racks, Rack Shelves and Associated Components"):
 *   - one rack unit (U) is exactly 44.45 mm of vertical pitch;
 *   - the mounting opening is 19 in = 482.6 mm wide;
 *   - mounting-hole centres are 465.0 mm apart horizontally (18.31 in);
 *   - square mounting holes are 9.5 mm on a 15.875 mm (0.625 in) vertical pitch.
 */

export const MM_PER_U = 44.45;
export const MM_PER_HALF_U = MM_PER_U / 2;
export const MM_PER_IN = 25.4;
/** EIA-310-D §4: nominal width of the 19 in mounting opening. */
export const EIA310_OPENING_WIDTH_MM = 482.6;
/** EIA-310-D: horizontal distance between mounting-hole column centres. */
export const EIA310_HOLE_CENTRE_MM = 465.0;
export const EIA310_HOLE_SQUARE_MM = 9.5;
export const EIA310_HOLE_PITCH_MM = 15.875;

export type RailPosition = 'front' | 'rear';
export type FeedId = 'A' | 'B';
export type Channel = 'left' | 'right';

/** Global horizontal placement strategies (PRD §2.2). */
export type PlacementStrategy = 'BOTTOM' | 'TOP' | 'CENTER';

export type DeviceCategory =
  | 'server'
  | 'storage'
  | 'network'
  | 'security'
  | 'kvm'
  | 'patch-panel'
  | 'blank'
  | 'pdu-horizontal'
  | 'pdu-vertical'
  | 'ups';

/** IEC 60320 / IEC 60309 inlet families that drive cord-bend buffers (PRD §2.2). */
export type InletType = 'C14' | 'C20' | 'IEC-309-32A' | 'IEC-309-63A' | 'HARDWIRED';

export type OutletCount = { c13: number; c19: number };

/** A piece of equipment as defined by the catalogue (a template). */
export interface DeviceSpec {
  id: string;
  vendor: string;
  model: string;
  category: DeviceCategory;
  /** Nameplate height in U. Zero-U (vertical PDU) devices use 0. */
  heightU: number;
  /** Chassis depth measured rearward from the mounting rail face. */
  depthMm: number;
  /** Body length for zero-U vertical PDUs, in mm. */
  lengthMm?: number;
  widthMm?: number;
  weightKg: number;
  /** Steady-state draw of the whole device, in watts. */
  powerDrawW: number;
  /** Number of power inlets (PSUs) on the device. */
  psuCount: number;
  /** Inlet type per PSU; index 0 = PSU-1. */
  inlets: InletType[];
  /** Rails the equipment may be mounted to. */
  rails: RailPosition[];
  /** PDU outlet inventory. */
  outlets?: OutletCount;
  /** PDU branch rating, amps. */
  ratedAmps?: number;
  note?: string;
}

/** A physical unit in the inventory tray or mounted in a rack. */
export interface DeviceInstance {
  uid: string;
  specId: string;
  assetTag: string;
}

export interface RackPreset {
  id: string;
  name: string;
  /** Total usable U height (1..N grid, PRD §2.1). */
  totalU: number;
  externalWidthMm: number;
  externalDepthMm: number;
  /** Front reference plane (inner face of the front frame) -> front rail plane. */
  frontRailOffsetMm: number;
  /** Front reference plane -> rear rail plane (adjustable on real enclosures). */
  rearRailOffsetMm: number;
  rearRailAdjustRangeMm: [number, number];
  /** Depth consumed by the front door / bezel frame. */
  frontObstructionMm: number;
  /** Depth consumed by the rear door / cable-management frame. */
  rearObstructionMm: number;
  /** Lateral width available per rear vertical cable channel. */
  zeroUChannelWidthMm: number;
  maxStaticLoadKg: number;
  /** Per-feed available branch capacity in watts. */
  feedCapacityW: Record<FeedId, number>;
  branchCircuitLabel: Record<FeedId, string>;
}

/** A rack-mounted (horizontal) placement. `startU` is the 1-based lowest U. */
export interface Placement {
  id: string;
  instanceId: string;
  specId: string;
  startU: number;
  spanU: number;
  rail: RailPosition;
  /** Feed a horizontal PDU is energised from. */
  feed?: FeedId;
  circuitLabel?: string;
}

/** A zero-U vertical PDU parked in a rear cable channel. */
export interface VerticalPlacement {
  id: string;
  instanceId: string;
  specId: string;
  channel: Channel;
  /** Offset from the bottom of the channel, in mm. */
  startMm: number;
  lengthMm: number;
  feed?: FeedId;
  circuitLabel?: string;
}

export type Severity = 'info' | 'warning' | 'error';

export type DiagnosticCode =
  | 'OUT_OF_BOUNDS'
  | 'U_OVERLAP'
  | 'RAIL_CONFLICT'
  | 'DEPTH_EXCEEDED'
  | 'RECESS_RAIL_MISMATCH'
  | 'CLEARANCE_BLOCKED'
  | 'CHANNEL_OVERFLOW'
  | 'CHANNEL_OVERLAP'
  | 'CHANNEL_WIDTH'
  | 'OUTLET_EXHAUSTED'
  | 'SINGLE_FEED'
  | 'FEED_OVERLOAD'
  | 'FEED_IMBALANCE'
  | 'LOAD_EXCEEDED'
  | 'U_CAPACITY'
  | 'UNPOWERED'
  | 'OK';

export interface Diagnostic {
  id: string;
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Human-readable subject, e.g. "Dell PowerEdge R760 (U12-U13)". */
  subject: string;
  uRange?: [number, number];
  placementIds: string[];
}

/** A candidate mounting request validated by the spatial engine. */
export interface PlacementRequest {
  instanceId: string;
  specId: string;
  startU: number;
  spanU: number;
  rail: RailPosition;
  /** Placement being moved (excluded from collision tests). */
  movingPlacementId?: string;
}

export interface Violation {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  uRange?: [number, number];
}
