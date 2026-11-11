import type { AppJson, AppViewSnapshot, MmViewDescription, VerifiedAppBundle, AppInformation } from '../protocol/app-package.js';
export interface AppInstanceScope {
  readonly hostId: string; readonly principalId: string; readonly instanceId: string;
  readonly bundleDigest: string; readonly contentId: string; readonly descriptorRevision: number;
  readonly parameters: Readonly<Record<string, string>>;
}
export interface AppViewObservation {
  readonly scope: AppInstanceScope; readonly snapshot: AppViewSnapshot;
  readonly authority: 'FRAME_REPORTED'; readonly stateScope: 'app-view'; readonly revisionScope: 'app-defined-key';
}
export interface AppViewInvokeRequest {
  contentId: string; descriptorRevision: number; instanceId: string; bundleDigest: string;
  expectedStateRevision: number; actionId: string; input: AppJson; idempotencyKey: string;
}
export type AppInvokeOutcome = (AppViewObservation & { ok: true; output: AppJson; actionId: string; idempotencyKey: string; expectedStateRevision: number })
  | { ok: false; code: string; reason: string };
export interface AppHost {
  id: string; principalId: string; theme?: 'dark' | 'light'; styles?: Record<string, string>;
  authorize(request: { operation: string; scope: AppInstanceScope; requirements: { admin: boolean }; signal: AbortSignal; [key: string]: unknown }): boolean | { allowed: boolean } | Promise<boolean | { allowed: boolean }>;
  /**
   * Host-owned providers a package may name in `tools`. A `command` provider changes state held by a
   * host-registered external executor. The host authorizes it as operation `command` and supplies
   * `requestId`; the provider must use that key so an uncertain result is reconciled, never resent.
   */
  tools?: Record<string, { effect: 'read' | 'command'; call(input: AppJson, context: { scope: AppInstanceScope; signal: AbortSignal; requestId?: string }): AppJson | Promise<AppJson> }>;
  remember?(parameters: Record<string, string>, context: { scope: AppInstanceScope; signal: AbortSignal }): void | Promise<void>;
  open?(content: string, context: { scope: AppInstanceScope }): void | Promise<void>;
  openLink?(url: string, context: { scope: AppInstanceScope }): void | Promise<void>;
  draftMessage?(text: string): void;
  /** Opt in only when the host preserves subjects/drafts and implements blocks and explicit reveal. */
  informationProfile?: 'hoh/app-information@2';
  information?(entry: Omit<AppInformation, 'from'> & { origin?: { x: number; y: number } }): void | boolean | Promise<void | boolean>;
  onError?(error: { ok: false; code: string; reason: string }): void;
}
export interface MountedAppContent {
  readonly node: HTMLIFrameElement; readonly ready: Promise<boolean>; readonly scope: AppInstanceScope; readonly bundle: VerifiedAppBundle;
  status(): { ready: boolean; closed: boolean; error: { code: string; reason: string } | null };
  describe(): Promise<{ profile: string; scope: AppInstanceScope; packageName: string; packageVersion: number; description: MmViewDescription | null; stateAuthority: 'FRAME_REPORTED'; stateScope: 'app-view' }>;
  read(): Promise<AppViewObservation>;
  subscribe(listener: (observation: AppViewObservation) => void): Promise<() => void>;
  invoke(request: AppViewInvokeRequest): Promise<AppInvokeOutcome>;
  flush(): Promise<void>;
  canReplace(): Promise<boolean>;
  refresh(): void; close(): void; teardown(): void;
}
export declare const APP_DOCUMENT_CSP: string;
export declare function createAppDocument(bundle: VerifiedAppBundle, options: { channel: string; styles?: string }): string;
export declare function mountAppContent(options: {
  bundle: VerifiedAppBundle; host: AppHost; params?: Record<string, string>; signal?: AbortSignal;
  stage?: HTMLElement; timeoutMs?: number;
  documentUrl?: (context: { bundle: VerifiedAppBundle; channel: string }) => string | Promise<string>;
}): Promise<MountedAppContent>;
