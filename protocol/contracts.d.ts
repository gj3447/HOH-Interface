export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = boolean | Record<string, unknown>;
export type Effect = 'read' | 'write' | 'external';
export interface ContentAction {
  '@id'?: string;
  id: string; title: string; description: string;
  inputSchema: Schema; outputSchema: Schema; effect: Effect;
  requiresConfirmation: boolean; gestureRequired: boolean;
}
export interface ContentDescriptor {
  '@context': Record<string, unknown>;
  '@type'?: 'h:Content';
  id: string; title: string; description: string; protocolVersion: '0.1'; descriptorRevision: number;
  stateSchema: Schema; actions: ContentAction[]; events?: Array<'stateChanged'>; profiles?: string[]; links?: string[];
}
export interface ContentSnapshot { contentId: string; descriptorRevision: number; stateRevision: number; state: Json; }
export interface TrustedActor { principalId: string; [key: string]: unknown; }
export interface InvokeRequest { contentId: string; descriptorRevision: number; actionId: string; input: Json; expectedStateRevision: number; idempotencyKey: string; }
export interface Receipt { contentId: string; descriptorRevision: number; beforeStateRevision: number; stateRevision: number; actor: TrustedActor; actionId: string; input: Json; idempotencyKey: string; confirmed: boolean; userGesture: boolean; recordedAt: string; provenance: { protocolVersion: '0.1'; effect: 'read' | 'write' }; }
export interface InvokeResult { ok: true; snapshot: ContentSnapshot; output: Json; receipt: Receipt; }
export interface ContentRuntime {
  describe(options: { actor: TrustedActor; signal?: AbortSignal }): Promise<ContentDescriptor>;
  read(options: { actor: TrustedActor; signal?: AbortSignal }): Promise<ContentSnapshot>;
  subscribe(listener: (snapshot: ContentSnapshot) => void | Promise<void>, options: { actor: TrustedActor; signal?: AbortSignal }): Promise<() => void>;
  invoke(request: InvokeRequest, options: { actor: TrustedActor; confirmed?: boolean; userGesture?: boolean; signal?: AbortSignal }): Promise<InvokeResult>;
  close(): Promise<void>;
}
export interface ContentRuntimeHost {
  description: ContentDescriptor;
  initialState: Json;
  handlers: Record<string, (context: { input: Json; state: Json; actor: TrustedActor; action: ContentAction; signal?: AbortSignal }) => { state: Json; output: Json } | Promise<{ state: Json; output: Json }>>;
  validate(schema: Schema, value: Json): boolean;
  authorize(context: { actor: TrustedActor; action: ContentAction | null; request: Record<string, unknown>; snapshot: ContentSnapshot; signal?: AbortSignal }): boolean | { allowed: boolean } | Promise<boolean | { allowed: boolean }>;
  projectDescription?: (context: Record<string, unknown>) => ContentDescriptor | undefined | Promise<ContentDescriptor | undefined>;
  projectSnapshot?: (context: Record<string, unknown>) => ContentSnapshot | undefined | Promise<ContentSnapshot | undefined>;
  projectResult?: (context: Record<string, unknown>) => Json | undefined | Promise<Json | undefined>;
  now?: () => number | string | Date;
  idempotencyLimit?: number;
}
export declare function createContentRuntime(host: ContentRuntimeHost): ContentRuntime;
export declare class ContentRuntimeError extends Error { code: string; details?: Json; }
