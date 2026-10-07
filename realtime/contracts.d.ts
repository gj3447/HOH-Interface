/** Copyright (C) 2026 MetaHumotonic Foundation. SPDX-License-Identifier: AGPL-3.0-only */
export type RealtimeMode = 'audio' | 'video' | 'broadcast';
export type RealtimeRole = 'participant' | 'publisher' | 'viewer';
export type RealtimeStatus = 'idle' | 'joining' | 'waiting' | 'connected' | 'reconnecting' | 'error' | 'closed';
export type RealtimeDescriptor = { mode: 'audio' | 'video'; role: 'participant' } | { mode: 'broadcast'; role: 'publisher' | 'viewer' };
export interface ViewContext { readonly contentId: string; readonly viewRevision?: number; readonly manifestId?: string; readonly manifestRevision?: string | number; }
export interface RealtimeCapabilities { readonly audio: boolean; readonly video: boolean; readonly broadcast: boolean; readonly screenShare: boolean; readonly scope?: string; readonly maxPeers?: number; }
export interface RealtimeSnapshot {
  readonly status: RealtimeStatus;
  readonly localStream: MediaStream | null;
  readonly peers: readonly { readonly id: string; readonly stream: MediaStream | null; readonly state: 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' }[];
  readonly microphoneEnabled: boolean;
  readonly cameraEnabled: boolean;
  readonly screenSharing: boolean;
  readonly error: null | { readonly code?: string; readonly message: string };
  readonly capabilities: RealtimeCapabilities;
}
export interface RealtimeConnection {
  snapshot(): Partial<RealtimeSnapshot>;
  setMicrophone(enabled: boolean): void | Promise<void>;
  setCamera(enabled: boolean): void | Promise<void>;
  shareScreen(): Promise<void>;
  stopScreenShare(): void | Promise<void>;
  close(): void | Promise<void>;
}
export interface RealtimeProvider {
  readonly capabilities: RealtimeCapabilities;
  connect(request: { roomId: string; mode: RealtimeMode; role: RealtimeRole; signal: AbortSignal; onUpdate(snapshot: Partial<RealtimeSnapshot>): void; context?: ViewContext }): Promise<RealtimeConnection>;
}
export interface RealtimeHost {
  provider: RealtimeProvider;
  /** Server authorization belongs here. Client content hints never grant room access or publishing rights. */
  authorize(input: { context: ViewContext; request: RealtimeDescriptor; signal: AbortSignal }): Promise<{ roomId: string; mode: RealtimeMode; role: RealtimeRole }>;
}
export interface RealtimeSession {
  getSnapshot(): RealtimeSnapshot;
  subscribe(listener: (snapshot: RealtimeSnapshot) => void): () => void;
  isActive(): boolean;
  join(request: { mode: RealtimeMode; role: RealtimeRole; context?: ViewContext; roomId?: string }): Promise<RealtimeSnapshot>;
  leave(): Promise<number>;
  close(): Promise<RealtimeSnapshot>;
  setMicrophone(enabled: boolean): Promise<unknown>;
  setCamera(enabled: boolean): Promise<unknown>;
  shareScreen(): Promise<unknown>;
  stopScreenShare(): Promise<unknown>;
}
