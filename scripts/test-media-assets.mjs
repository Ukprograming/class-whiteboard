import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { assertMediaSize, RESUMABLE_UPLOAD_THRESHOLD } from '../public/js/media-limits.mjs';

// Exercise actual serialization, download and distribution functions against
// in-memory Storage. This verifies asset behavior, not production authorization.
const stored = new Map();
let uploads = 0;
const storage = {
  async upload(path, blob) { stored.set(path, blob); uploads++; return { error: null }; },
  async download(path) { return stored.has(path) ? { data: stored.get(path) } : { error: new Error('missing') }; },
  async list(folder) { return { data: [...stored.keys()].filter(p => p.startsWith(folder + '/')).map(p => ({ name: p.slice(folder.length + 1) })) }; },
  async copy(from, to) { if (!stored.has(from)) return { error: new Error('missing') }; stored.set(to, stored.get(from)); return {}; },
  async remove(paths) { paths.forEach(p => stored.delete(p)); return {}; },
};
const client = { storage: { from: () => storage } };
client.auth = { getSession: async () => ({ data: { session: { access_token: 'fixture-token' } } }) };
const events = [];
let resumableCalls = 0;
const source = readFileSync('public/js/supabase-api.js', 'utf8');
const api = vm.createContext({ supabase: client, SUPABASE_URL: 'https://test.supabase.co', STORAGE_BUCKET: 'class-whiteboard', Blob, URL, fetch, crypto, console, assertMediaSize, RESUMABLE_UPLOAD_THRESHOLD,
  CustomEvent, window: { dispatchEvent: event => events.push(event.detail) },
  uploadResumable: async options => {
    resumableCalls++;
    assert.equal(await options.getToken(), 'fixture-token');
    options.onProgress({ sent: 6000000, total: options.blob.size, retrying: false });
    await storage.upload(options.path, options.blob);
  },
});
vm.runInContext(source.slice(source.indexOf('function boardPageDataList('), source.indexOf('export const boardApi =')), api);
const urls = [];
const board = { pages: [{ boardData: { backgroundStyle: 'ruled', objects: ['image', 'video', 'audio'].map((kind, index) => {
  const mime = ['image/png', 'video/webm;codecs=vp8,opus', 'audio/wav'][index];
  const url = URL.createObjectURL(new Blob([kind], { type: mime })); urls.push(url);
  return { kind, assetKey: kind, assetMimeType: mime, [kind === 'image' ? 'imageObjectUrl' : 'videoObjectUrl']: url };
}) } }] };
const snapshotPath = 'teachers/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/board.json';
try {
  assert.doesNotThrow(() => assertMediaSize({ size: 45_000_000 }, '10分動画.mp4'));
  assert.throws(() => assertMediaSize({ size: 45_000_001 }, '10分動画.mp4'), /45MB以下/);
  await assert.rejects(() => api.externalizeBoardAssets({ objects: [{ kind: 'video', assetSizeBytes: 45_000_001 }] }, snapshotPath), /45MB以下/);
  assert.equal(uploads, 0, 'oversized restored media is rejected before any upload');
  const references = await api.externalizeBoardAssets(board, snapshotPath);
  assert.equal(references.length, 3);
  assert.equal(uploads, 3);
  const objects = board.pages[0].boardData.objects;
  assert(objects[1].assetPath.endsWith('.webm'), 'codec-qualified recording MIME keeps the correct extension');
  assert(objects[2].assetPath.endsWith('.wav'));
  assert(objects.every(o => !o.imageObjectUrl && !o.videoObjectUrl));
  await api.externalizeBoardAssets(board, snapshotPath);
  assert.equal(uploads, 3, 'saving again reuses immutable assets');
  objects[0].imageObjectUrl = 'blob:https://expired.example/stale-image';
  await api.hydrateBoardAssets(board);
  assert.notEqual(objects[0].imageObjectUrl, 'blob:https://expired.example/stale-image', 'Storage hydration replaces an expired draft URL');
  assert.equal(await (await fetch(objects[0].imageObjectUrl)).text(), 'image');
  assert.equal(await (await fetch(objects[2].videoObjectUrl)).text(), 'audio');
  urls.push(...objects.map(o => o.imageObjectUrl || o.videoObjectUrl));
  const failedDraft = {
    pages: [{
      boardData: {
        strokes: [{ id: 17, points: [{ x: 1, y: 2 }] }],
        objects: [{
          id: 23,
          kind: 'image',
          assetKey: 'missing-image',
          assetPath: 'students/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/missing.png',
          imageObjectUrl: 'blob:https://expired.example/missing-image',
        }],
      },
    }],
  };
  const failedHydration = await api.hydrateBoardAssets(failedDraft, { includeFailures: true });
  assert.equal(Array.from(failedHydration.failedAssetPaths).join(','), 'students/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/missing.png');
  assert.equal(failedHydration.boardData.pages[0].boardData.strokes[0].id, 17, 'failed media does not discard unsaved strokes');
  assert.equal(failedHydration.boardData.pages[0].boardData.objects[0].id, 23, 'failed media remains in the draft');
  assert.equal(failedHydration.boardData.pages[0].boardData.objects[0].assetLoadError, true);
  assert.equal(failedHydration.boardData.pages[0].boardData.objects[0].assetPath, 'students/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/missing.png');
  const missingBackgroundPath = 'students/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/missing-background.png';
  const failedBackgroundDraft = {
    backgroundStyle: 'grid',
    strokes: [{ id: 31, type: 'pen', color: '#111827', width: 3, points: [{ x: 4, y: 5 }] }],
    objects: [],
    background: {
      assetKey: 'missing-background',
      assetPath: missingBackgroundPath,
      assetMimeType: 'image/png',
      assetSizeBytes: 1234,
      objectUrl: 'blob:https://expired.example/missing-background',
      width: 1280,
      height: 720,
    },
  };
  const failedBackgroundHydration = await api.hydrateBoardAssets(failedBackgroundDraft, { includeFailures: true });
  assert.equal(Array.from(failedBackgroundHydration.failedAssetPaths).join(','), missingBackgroundPath);

  const whiteboardSource = readFileSync('public/js/whiteboard.js', 'utf8')
    .replace(/^import\s+[\s\S]*?from\s+"[^"\n]+";\r?\n/gm, '')
    .replace('export class Whiteboard', 'class Whiteboard');
  class FailedImage {
    set src(value) { this.currentSrc = value; this.onerror?.(); }
  }
  const whiteboardRuntime = vm.createContext({ console, crypto, Image: FailedImage });
  vm.runInContext(`${whiteboardSource}\nglobalThis.Whiteboard = Whiteboard;`, whiteboardRuntime);
  const recoveredBoard = Object.assign(Object.create(whiteboardRuntime.Whiteboard.prototype), {
    backgroundStyle: 'grid', _hidePagePattern: false, showGrid: true,
    scale: 1, offsetX: 0, offsetY: 0, nextObjectId: 1, nextStrokeId: 1,
    penColor: '#111827', penWidth: 3, strokes: [], objects: [], history: [],
    bgCanvas: { width: 0, height: 0 },
    bgCtx: { clearRect() {}, drawImage() {} },
    render() {}, _setSelected() {}, onBackgroundStyleChange() {},
  });
  recoveredBoard._importSinglePageData(failedBackgroundHydration.boardData, { preserveDirty: true });
  recoveredBoard.strokes.push({ id: 32, type: 'pen', color: '#111827', width: 3, points: [{ x: 6, y: 7 }] });
  const reexportedBackgroundDraft = recoveredBoard._exportSinglePageData();
  assert.equal(reexportedBackgroundDraft.strokes.length, 2, 'editing after recovery keeps existing and new strokes');
  assert.equal(reexportedBackgroundDraft.background.assetPath, missingBackgroundPath, 'failed background keeps its Storage path on the next draft save');
  assert.equal(reexportedBackgroundDraft.background.width, 1280);
  assert.equal(reexportedBackgroundDraft.background.height, 720);
  const serialized = structuredClone(board);
  serialized.pages[0].boardData.objects.forEach(o => { delete o.imageObjectUrl; delete o.videoObjectUrl; });
  stored.set(snapshotPath, new Blob([JSON.stringify(serialized)]));
  const edgeSource = readFileSync('supabase/functions/copy-board-to-class/index.ts', 'utf8');
  const edge = vm.createContext({ Blob, console });
  vm.runInContext(stripTypeScriptTypes(edgeSource.slice(edgeSource.indexOf('const STORAGE_BUCKET'), edgeSource.indexOf('Deno.serve('))), edge);
  const distributed = await edge.createImmutableDistributionSnapshot(client, snapshotPath, 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
  const received = JSON.parse(await stored.get(distributed.targetSnapshotPath).text());
  assert.equal(received.pages[0].boardData.backgroundStyle, 'ruled');
  for (const o of received.pages[0].boardData.objects) {
    assert(o.assetPath.startsWith('shared/'));
    assert.equal(await stored.get(o.assetPath).text(), o.kind);
  }
  const foreign = structuredClone(serialized);
  foreign.pages[0].boardData.objects = [{ kind: 'audio', assetPath: 'teachers/foreign/private.wav' }];
  stored.set(snapshotPath, new Blob([JSON.stringify(foreign)]));
  await assert.rejects(() => edge.createImmutableDistributionSnapshot(client, snapshotPath, 'other'), /authorized Storage path/);
  const largeUrl = URL.createObjectURL(new Blob([new Uint8Array(7 * 1024 * 1024)], { type: 'video/mp4' }));
  urls.push(largeUrl);
  const large = { objects: [{ kind: 'video', assetKey: 'large', videoObjectUrl: largeUrl }] };
  await api.externalizeBoardAssets(large, snapshotPath);
  assert.equal(resumableCalls, 1, 'large media uses resumable upload in the real save pipeline');
  assert.equal(events[0].state, 'uploading');
  assert.equal(events.at(-1).state, 'complete');
  assert(!large.objects[0].videoObjectUrl && large.objects[0].assetPath.endsWith('.mp4'));
  console.log('Media asset save/reload/reuse/distribution and unauthorized-path checks passed.');
} finally { urls.forEach(url => URL.revokeObjectURL(url)); }
