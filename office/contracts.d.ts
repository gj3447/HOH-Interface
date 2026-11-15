export type OfficeEditorKind = "document" | "sheet" | "slides"
export type OfficeJson = null | boolean | number | string | OfficeJson[] | { readonly [key: string]: OfficeJson }
export interface OfficeAssetRef { readonly assetId: string; readonly role: "original" | "derived"; readonly sha256: string; readonly parentRevision?: number }
export interface OfficeBody { readonly schema: "hoh/office-document@1"; readonly editorKind: OfficeEditorKind; readonly schemaVersion: 1; readonly snapshot: Readonly<Record<string, OfficeJson>>; readonly assets: readonly OfficeAssetRef[] }
export interface OfficeWriteBody { readonly title: string; readonly body: OfficeBody }
export interface OfficeDocument { readonly documentId: string; readonly ownerPrincipalId: string; readonly title: string; readonly version: number; readonly revision: number; readonly digest: string; readonly body: OfficeBody }
export function validateDocumentSnapshot(value: unknown): Readonly<Record<string, OfficeJson>>
export function decodeOfficeBody(value: unknown): OfficeBody
export function decodeOfficeWrite(value: unknown): OfficeWriteBody
