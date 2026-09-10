import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

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
const source = readFileSync('public/js/supabase-api.js', 'utf8');
const api = vm.createContext({ supabase: client, STORAGE_BUCKET: 'class-whiteboard', Blob, URL, fetch, crypto, console });
vm.runInContext(source.slice(source.indexOf('function boardPageDataList('), source.indexOf('export const boardApi =')), api);
const urls = [];
const board = { pages: [{ boardData: { backgroundStyle: 'ruled', objects: ['image', 'video', 'audio'].map((kind, index) => {
  const mime = ['image/png', 'video/webm;codecs=vp8,opus', 'audio/wav'][index];
  const url = URL.createObjectURL(new Blob([kind], { type: mime })); urls.push(url);
  return { kind, assetKey: kind, assetMimeType: mime, [kind === 'image' ? 'imageObjectUrl' : 'videoObjectUrl']: url };
}) } }] };
const snapshotPath = 'teachers/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/board.json';
try {
  const references = await api.externalizeBoardAssets(board, snapshotPath);
  assert.equal(references.length, 3);
  assert.equal(uploads, 3);
  const objects = board.pages[0].boardData.objects;
  assert(objects[1].assetPath.endsWith('.webm'), 'codec-qualified recording MIME keeps the correct extension');
  assert(objects[2].assetPath.endsWith('.wav'));
  assert(objects.every(o => !o.imageObjectUrl && !o.videoObjectUrl));
  await api.externalizeBoardAssets(board, snapshotPath);
  assert.equal(uploads, 3, 'saving again reuses immutable assets');
  await api.hydrateBoardAssets(board);
  assert.equal(await (await fetch(objects[2].videoObjectUrl)).text(), 'audio');
  urls.push(...objects.map(o => o.imageObjectUrl || o.videoObjectUrl));
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
  console.log('Media asset save/reload/reuse/distribution and unauthorized-path checks passed.');
} finally { urls.forEach(url => URL.revokeObjectURL(url)); }
