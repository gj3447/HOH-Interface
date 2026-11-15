const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const fail = reason => { throw Object.assign(new Error(reason), { code: 'INVALID_OFFICE_DOCUMENT' }); };
const fields = (value, allowed, required = []) => {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('Unsupported document fields');
};
const json = (value, depth = 0, seen = new Set(), counter = { n: 0 }) => {
  if (depth > 32 || ++counter.n > 100000) fail('Document exceeds structural limits');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value) && !plain(value) || Object.getOwnPropertySymbols(value).length) fail('Document object is unsafe');
  if (seen.has(value)) fail('Document is cyclic');
  seen.add(value);
  const names = Object.getOwnPropertyNames(value).filter(key => !Array.isArray(value) || key !== 'length');
  if (names.length !== Object.keys(value).length || Array.isArray(value) && (names.length !== value.length || names.some((key, index) => key !== String(index)))) fail('Document fields must be dense enumerable data');
  const out = Array.isArray(value) ? [] : {};
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (forbidden.has(key) || !descriptor || !Object.hasOwn(descriptor, 'value')) fail('Document key is unsafe');
    out[key] = json(descriptor.value, depth + 1, seen, counter);
  }
  seen.delete(value); return out;
};
const blocks = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule']);
const marks = new Set(['bold', 'italic', 'underline', 'strike', 'code']);
const checkNode = (node, parent) => {
  fields(node, ['type','content','attrs','text','marks'], ['type']);
  const type = node.type, content = node.content ?? [], attrs = node.attrs ?? {};
  if (!Array.isArray(content)) fail('Document children must be an array');
  if (parent === null ? type !== 'doc' : parent === 'bulletList' || parent === 'orderedList' ? type !== 'listItem'
    : parent === 'paragraph' || parent === 'heading' ? !['text','hardBreak'].includes(type)
    : parent === 'codeBlock' ? type !== 'text' : !blocks.has(type)) fail('Unsupported document node or nesting');
  if (type === 'text') {
    if (typeof node.text !== 'string' || !node.text.length || node.content !== undefined || node.attrs !== undefined) fail('Invalid text node');
  } else if (node.text !== undefined) fail('Only text nodes contain text');
  if (type === 'heading') { fields(attrs, ['level']); if (attrs.level !== undefined && (!Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)) fail('Invalid heading level'); }
  else if (type === 'orderedList') {
    fields(attrs, ['start','type']);
    if (attrs.start !== undefined && (!Number.isSafeInteger(attrs.start) || attrs.start < 1)) fail('Invalid list start');
    if (attrs.type !== undefined && attrs.type !== null && !['1','a','A','i','I'].includes(attrs.type)) fail('Unsupported list style');
  } else if (type === 'codeBlock') {
    fields(attrs, ['language']);
    if (attrs.language !== undefined && attrs.language !== null && (typeof attrs.language !== 'string' || !/^[A-Za-z0-9_+-]{1,64}$/.test(attrs.language))) fail('Invalid code language');
  } else fields(attrs, []);
  if (node.marks !== undefined) {
    if (!['text','hardBreak'].includes(type) || parent === 'codeBlock' || !Array.isArray(node.marks)) fail('Unsupported marks');
    const seen = new Set();
    for (const mark of node.marks) {
      fields(mark, ['type','attrs'], ['type']); fields(mark.attrs ?? {}, []);
      if (!marks.has(mark.type) || seen.has(mark.type)) fail('Unsupported or duplicate mark'); seen.add(mark.type);
    }
    if (seen.has('code') && seen.size > 1) fail('Code excludes other marks');
  }
  if (['hardBreak','horizontalRule','text'].includes(type)) { if (node.content !== undefined) fail('Leaf node cannot have children'); return; }
  if (['doc','blockquote','bulletList','orderedList','listItem'].includes(type) && !content.length) fail('Required document child is missing');
  if (type === 'listItem' && content[0]?.type !== 'paragraph') fail('List item must start with a paragraph');
  for (const child of content) checkNode(child, type);
};
export const validateDocumentSnapshot = value => {
  const snapshot = json(value); checkNode(snapshot, null);
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 1024 * 1024) fail('Document exceeds 1 MiB');
  return snapshot;
};
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
export const decodeOfficeBody = value => {
  const body = json(value);
  fields(body, ['schema','editorKind','schemaVersion','snapshot','assets'], ['schema','editorKind','schemaVersion','snapshot','assets']);
  if (body.schema !== 'hoh/office-document@1' || !['document','sheet','slides'].includes(body.editorKind) || body.schemaVersion !== 1 || !plain(body.snapshot) || !Array.isArray(body.assets) || body.assets.length > 64) fail('Unsupported document body');
  const ids = new Set();
  for (const asset of body.assets) {
    fields(asset, asset.role === 'derived' ? ['assetId','role','sha256','parentRevision'] : ['assetId','role','sha256'], ['assetId','role','sha256']);
    if (!identifier(asset.assetId) || !['original','derived'].includes(asset.role) || !/^[a-f0-9]{64}$/.test(asset.sha256) || ids.has(asset.assetId)) fail('Invalid asset reference');
    if (asset.role === 'derived' && (!Number.isSafeInteger(asset.parentRevision) || asset.parentRevision < 1)) fail('Invalid derived asset'); ids.add(asset.assetId);
  }
  if (body.editorKind === 'document') checkNode(body.snapshot, null);
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 1024 * 1024) fail('Document exceeds 1 MiB');
  return body;
};
export const decodeOfficeWrite = value => {
  const input = json(value); fields(input, ['title','body'], ['title','body']);
  if (!identifier(input.title) || !input.title.trim() || input.title.length > 240) fail('Invalid document title');
  return { title: input.title.trim(), body: decodeOfficeBody(input.body) };
};
