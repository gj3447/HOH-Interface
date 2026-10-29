import type { AppJson, AppViewSnapshot, MmViewDescription, VerifiedAppBundle } from '../protocol/app-package.js';
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
  tools?: Record<string, { effect: 'read'; call(input: AppJson, context: { scope: AppInstanceScope; signal: AbortSignal }): AppJson | Promise<AppJson> }>;
  remember?(parameters: Record<string, string>, context: { scope: AppInstanceScope; signal: AbortSignal }): void | Promise<void>;
  open?(content: string, context: { scope: AppInstanceScope }): void | Promise<void>;
  openLink?(url: string, context: { scope: AppInstanceScope }): void | Promise<void>;
  draftMessage?(text: string): void;
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
