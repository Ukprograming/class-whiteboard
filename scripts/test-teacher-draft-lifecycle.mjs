import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createTeacherDraftKey, normalizeTeacherDraftIdentity} from '../public/js/teacher-draft-store.mjs';

const source = readFileSync('public/js/teacher.js', 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}
const runtime = [
  section('function getCurrentTeacherDraftIdentity(', 'window.addEventListener("pagehide"'),
  section('async function teacherSaveBoardInternal(', 'async function teacherLoadBoardInternal('),
  section('async function resetTeacherBoardForNewFile(', 'async function createNewTeacherBoard('),
  section('async function confirmTeacherBoardChange(', 'function defaultDistributionTitle('),
].join('\n');

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
function harness() {
  let revision = 1;
  const persisted = [];
  const cleared = [];
  const board = {
    isBoardDirty: true,
    text: 'initial',
    getRevision: () => revision,
    edit(text) {this.text = text; this.isBoardDirty = true; revision++;},
    exportBoardData() {return {text:this.text};},
    restoreBoardDraft(data) {this.edit(data.text);},
    markSaved(expected) {if (revision !== expected) return false; this.isBoardDirty = false; return true;},
    newBoard() {this.text = ''; this.isBoardDirty = false; revision++;},
    applyAssetReferences() {this.assetApplications = (this.assetApplications || 0) + 1;},
  };
  const context = vm.createContext({
    createTeacherDraftKey, normalizeTeacherDraftIdentity,
    authenticatedTeacherId:'teacher-a', currentClassCode:'TEST',
    currentBoardOwnerKind:'teacher', currentBoardOwnerStudentId:'',
    currentBoardFileId:'old-file', currentBoardFileName:'old-name', lastUsedFolderPath:'old-folder',
    boardScopeMode:'teacher', boardScopeStudentNickname:'',
    teacherDraftSaveTimerId:null, teacherBoardLifecycleRevision:0,
    hasRestoredTeacherDraft:false, boardFileSaveInFlight:false,
    TEACHER_DRAFT_SAVE_DELAY_MS:150, teacherBoard:board,
    supabaseEnabled:true, BOARD_API_BASE:'/fixture', statusLabel:{},
    teacherDraftStore:{
      persist: async draft => {persisted.push(structuredClone(draft)); return true;},
      clear: async identity => {cleared.push(identity); return true;},
      load: async () => null,
    },
    boardApi:{enabled:true, saveBoard:async () => ({ok:true,fileId:'saved-file',fileName:'saved-name'})},
    showBoardChangeSaveDecision:async () => 'save', openBoardDialog(){}, closeBoardDialog(){},
    alert(){}, console:{log(){},warn(){},error(){}}, setTimeout, clearTimeout,
  });
  vm.runInContext(runtime, context);
  return {context, board, persisted, cleared};
}

{
  const {context, board, persisted, cleared} = harness();
  const response = deferred();
  const started = deferred();
  context.boardApi.saveBoard = () => {started.resolve(); return response.promise;};
  const saving = context.confirmTeacherBoardChange('switch');
  await started.promise;
  board.edit('written during save');
  response.resolve({ok:true,fileId:'saved-file',fileName:'saved-name'});
  assert.equal(await saving, false, 'save-and-switch must stop if newer edits remain');
  assert.equal(board.isBoardDirty, true);
  assert.equal(persisted.at(-1).boardData.text, 'written during save');
  assert.equal(cleared.length, 0, 'saving an older revision cannot clear the newer draft');
}
{
  const {context, board, persisted} = harness();
  context.teacherDraftStore.clear = async () => {board.edit('written during draft cleanup'); return true;};
  assert.equal(await context.teacherSaveBoardInternal('', 'name', 'old-file'), false);
  assert.equal(persisted.at(-1).boardData.text, 'written during draft cleanup');
}
{
  const {context, board} = harness();
  const response = deferred();
  context.boardApi.saveBoard = () => response.promise;
  const saving = context.teacherSaveBoardInternal('', 'name', 'old-file');
  await context.resetTeacherBoardForNewFile();
  context.currentClassCode = 'NEXT';
  response.resolve({ok:true,fileId:'old-class-file',fileName:'old-class-name'});
  assert.equal(await saving, false);
  assert.equal(context.currentBoardFileId, null, 'a late save cannot attach the old file to a new board');
  assert.equal(board.assetApplications || 0, 0);
}
{
  const {context, board} = harness();
  const hydration = deferred();
  const started = deferred();
  context.teacherDraftStore.load = async () => ({boardData:{text:'old draft'},ownerKind:'teacher'});
  context.boardApi.hydrateDraftAssets = () => {started.resolve(); return hydration.promise;};
  const restoring = context.restoreTeacherDraft('TEST');
  await started.promise;
  board.edit('typed while restoring');
  hydration.resolve({boardData:{text:'old draft'}});
  assert.equal(await restoring, false);
  assert.equal(board.text, 'typed while restoring');
}
{
  const {context, board, cleared} = harness();
  assert.equal(await context.teacherSaveBoardInternal('', 'name', 'old-file'), true);
  assert.equal(board.isBoardDirty, false);
  assert.equal(cleared.length, 1);
}
console.log('Teacher draft lifecycle tests passed (save/edit, cleanup/edit, late save and restore/edit races).');
