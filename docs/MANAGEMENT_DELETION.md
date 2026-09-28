# クラス・教員アカウントの削除

教員画面の「クラス・生徒管理」から、対象クラスまたは自分の教員アカウントを削除できます。
クラスコード（アカウント削除では「アカウント削除」）の入力と、教員パスワードの再確認が必要です。
他の教員アカウントを削除する管理者機能ではありません。

## 削除範囲

| 操作 | 削除対象 | 保持するもの |
| --- | --- | --- |
| クラス削除 | クラス、生徒の認証アカウント・プロフィール、対象ボード、配布・課題・共同編集、フォーム実施履歴・回答、関連Storageファイル | 他クラスで参照している教員教材、フォームのひな型と参照中の画像、他クラス・他教員のデータ |
| 自分の教員アカウント削除 | 所有する全クラスと生徒、教員プロフィール・認証アカウント、保存ボード・フォームのひな型、関連Storageファイル | 他教員のデータ |

削除したクラスの下書きは、操作中のブラウザのsessionStorageとIndexedDBからも消去します。
別端末のブラウザに保存された下書き、ダウンロード済みファイル、バックアップは遠隔削除できません。

## 処理と再試行

1. Edge Function `delete-management-target` がJWT、教員ロール、所有権、確認文字、パスワードを検証します。教員削除のIDはJWTから決定します。
2. `begin_management_deletion` が関連データの削除と、Storageパス・Auth IDの記録を1トランザクションで行います。削除済みプロフィールのJWTによるStorage操作をRLSで拒否します。
3. Storageの参照を再確認し、参照がなくなったファイルをStorage APIで削除します。1回あたり最大1,000オブジェクトです。参照中の教材は保持します。
4. Storage処理後にAuth APIで生徒アカウントを削除し、教員自身のAuthは最後に削除します。
5. 処理中断・時間切れ・通信失敗時は `management_deletion_jobs` に残りを保存します。既存の `process-storage-cleanup` の定期実行が再開します。実行中のリースは15分で再取得可能になります。

通常の不要ファイル回収の24時間猶予と異なり、明示的なクラス・アカウント削除は即時に実行します。
途中まで進んだ削除の取り消しはできません。画面は完全に処理できた場合だけ「削除が完了」と表示し、残りがある場合は受付IDを表示します。
削除記録とファイルパスの墓標は再実行・再参照防止のため保持します。教員名・パスワードは削除記録に保存しません。

## 公開前の適用順序

フロントエンドだけでは利用できません。[本番運用手順](PRODUCTION_OPERATIONS.md)の公開前確認を行い、次の順で適用します。

1. `20260928034833_add_management_deletion.sql` を適用する。
2. 新しい `delete-management-target` と、共有ヘルパーを含む更新版 `process-storage-cleanup` をデプロイする。新APIのJWT検証は有効にする。既存の定期処理の認証方式は維持する。
3. [定期回収の設定](STORAGE_CLEANUP_AUTOMATION.md)に従い、`STORAGE_CLEANUP_ENABLED` とSecretsを確認する。今回のrunner更新も反映する。定期実行が無効だと、中断された教員削除は手動実行まで完了しない。
4. 使い捨ての教員・2クラス・生徒・実ファイルで、削除後のDatabase、Auth、Storageの残件を確認する。別クラスで共有する教材が残り、削除対象の古いJWTで書き込めないこと、途中失敗後に再開することを確認する。
5. バックエンドの適用・実機確認後に既存のリリーススタンプを更新し、フロントエンドを公開する。

未完了件数の確認（サービス管理者のみ）:

```sql
select id, target_kind, state,
  jsonb_array_length(remaining_storage) as storage_targets,
  cardinality(remaining_users) as auth_users, updated_at
from public.management_deletion_jobs
where state <> 'completed'
order by updated_at;
```

大規模削除や通信障害では複数回の処理が必要です。実行中だったアップロードや既存の署名URLについても公開前の実機確認に含めてください。

## 検証

- `node scripts/test-management-deletion.mjs`: 認可・確認文字、パスワード不一致、Storageページング、Authとの順序、参照保持、途中失敗・再実行。APIはモック。
- `node scripts/test-management-deletion-browser.cjs`: 実際の教員画面で確認ダイアログ、パスワードエラー、処理中操作、320/768/1100px表示、ブラウザ下書き削除。認証・削除APIはモック。
- `scripts/verify-management-deletion.sql`: マイグレーション済みDBで、必ず `BEGIN` と `ROLLBACK` の間で実行する。使い捨てデータによる削除範囲・権限・参照・リースの検証。Storage/Auth APIの実削除検証ではない。
- `npm.cmd test`、`git diff --check`: 既存機能を含む回帰確認。

Storageの実体はSQLの `DELETE FROM storage.objects` では消さず、[公式Storage削除API](https://supabase.com/docs/guides/storage/management/delete-objects)を使用します。
