export type AppJson = null | boolean | number | string | AppJson[] | { [key: string]: AppJson };
export type MmShape =
  | { type: 'object'; properties: Record<string, MmShape>; required?: string[] }
  | { type: 'string'; enum?: string[]; maxLength?: number; pattern?: string }
  | { type: 'number' | 'integer'; enum?: number[]; minimum?: number; maximum?: number }
  | { type: 'boolean' | 'null' }
  | { type: 'array'; items: MmShape; maxItems?: number }
  | { anyOf: MmShape[] };
export interface MmViewAction {
  id: string; title: string; description: string; input: MmShape;
  gestureRequired: boolean; requiresConfirmation?: boolean;
}
export interface MmViewDescription {
  id: string; revision: number; description: string; state: MmShape; actions: MmViewAction[];
  controls?: 'playback'; links?: string[];
}
export interface MmAppPackage {
  schema: 'mm.content-package/v1'; name: string; version: number; title: string; summary: string;
  tools: string[]; params: string[]; hotReload?: boolean; admin?: boolean; icon?: string; color?: string;
  content?: MmViewDescription;
}
export interface VerifiedAppBundle {
  readonly profile: 'urn:hoh:profile:mm-published-app:1';
  readonly digest: string;
  readonly source: { readonly repository: string; readonly revision: string; readonly dir: string; readonly fixture?: boolean };
  readonly package: MmAppPackage; readonly template: string; readonly templateSha256: string;
}
export interface AppViewSnapshot {
  contentId: string; descriptorRevision: number; stateRevision: number; state: Record<string, AppJson>;
}
export declare class AppPackageError extends Error { code: string; }
export declare const MM_PACKAGE_PROFILE: 'urn:hoh:profile:mm-published-app:1';
export declare const MM_KIT_SLOT: '<!-- ailab-app-kit -->';
export declare const APP_LIMITS: Readonly<{ bundle: number; template: number; snapshot: number; resume: number }>;
export declare function appFail(code: string, message: string): never;
export declare function appJson(value: unknown, limit?: number): AppJson;
export declare function freezeAppJson<T>(value: T): Readonly<T>;
export declare function stableAppJson(value: AppJson): string;
export declare function assertMmShape(shape: unknown): asserts shape is MmShape;
export declare function decodeMmShape(shape: MmShape, value: unknown): AppJson;
export declare function parseMmPackageMetadata(raw: unknown): MmAppPackage;
export declare function parseMmPackage(raw: unknown, template: string): MmAppPackage;
export declare function appSha256(bytes: string | Uint8Array): Promise<string>;
export declare function readMmBundle(bytes: string | Uint8Array, options: { expectedDigest: string; allowFixture?: boolean }): Promise<VerifiedAppBundle>;
export declare function isVerifiedAppBundle(bundle: unknown): bundle is VerifiedAppBundle;
export declare function mmViewSnapshot(pkg: MmAppPackage, raw: unknown): AppViewSnapshot;
export declare function mmResumeInput(pkg: MmAppPackage, raw: unknown): Record<string, string>;
