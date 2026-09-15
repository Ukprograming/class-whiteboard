# 本番運用、バックアップ、容量管理

この文書ではSupabase DatabaseとStorageの両方を保全します。Database dumpだけではStorage内の画像・動画・音声本体は復元できません。Supabase Freeでは自動バックアップを前提にせず、授業データを保持する期間に合わせて手動バックアップ日を決めます。実行前に最新の公式料金・上限とCLIのヘルプを確認してください。

## 追加の運用準備

- [バックアップ・復元チェックリスト](BACKUP_CHECKLIST.md): 保存先、担当者、実施日時、復元結果を記録します。チェックリストを用意しただけでは取得・復元済みになりません。
- [不要ファイル回収の定期実行](STORAGE_CLEANUP_AUTOMATION.md): 6時間ごとのGitHub Actions workflowと、失敗・処理上限を検知するrunnerを用意しています。初期状態は無効で、Secrets設定と手動確認後に有効化します。

## 下書きの復元と確認範囲

生徒画面は、大きな画像などでsessionStorageの容量を超えた場合にも、復元用の小さな印を先に保存し、IndexedDBに退避した下書きを再読み込み後に探せるようにしています。

教員画面にも、編集中のボードを同じタブの再読み込み後に復元する機能を追加しています。教員アカウント・クラス・教材の所有者ごとに下書きを識別します。復元した内容は未保存として扱うため、内容を確認して通常の保存操作を行ってください。保存中に追記した内容は下書きとして残し、新規作成やクラスを離れる操作では保存・破棄・キャンセルの選択を尊重します。

これは端末内の一時的な復旧機能です。タブを閉じた後や別端末での復元、ブラウザのデータ消去後の復元は保証しません。ストレージ利用を拒否するブラウザ設定や容量不足では保存できない場合があります。新規挿入後、一度も保存していない動画・音声本体は再読み込みで復元できないため、ページを閉じる前に保存を完了してください。

`npm.cmd test` で容量超過時の退避・アカウント等の分離・回収runnerの失敗処理を確認します。`npm run test:browser:teacher-draft` はPlaywrightとEdgeが利用可能な環境で実行し、実画面の教員下書き復元と、生徒の実sessionStorage容量超過からIndexedDB経由で復元する操作を確認します。認証とStorage通信は模擬実装であり、本番の認証済み端末での受け入れ確認は別途必要です。

## リリース順序

GitHub Actionsは毎回 `npm test` を実行し、リポジトリ内の全migration・Edge Functionの内容が、検証済みバックエンドstampと一致するときだけPagesへ公開します。後続のフロントだけのcommitでも未適用バックエンドを見逃しません。不一致なら現在公開中のPagesを維持したままworkflowを失敗させます。

1. 対象commitを手元でcheckoutし、`npm.cmd ci` と `npm.cmd test` を実行します。
2. `npx supabase --version` と、使うコマンドの `--help` を確認します。
3. `npx supabase migration list --linked` でlocalと本番の履歴番号・名前を照合します。同名でも番号が違うmigrationを見つけたらそこで止め、SQL内容と本番適用状況を確認します。`migration repair` やlocalファイル名変更を根拠なく実行しません。
4. 本番プロジェクトを明示してmigrationとEdge Functionを適用します。Functionは一覧だけでなく、対象entry sourceがlocal最新版と一致することを確認します。
5. 教員1名・生徒2名を別プロファイルまたは別端末で認証し、今回変更した操作とクラス分離を確認します。
6. 適用したローカルソースを変更せずに `node scripts/release-preflight.mjs --print` でハッシュを記録します。
7. 同じソースについて実DB・Functionsの確認が成功した後だけ、`node scripts/release-preflight.mjs --write-stamp` を実行します。生成された `supabase/backend-release.json` をソースと同じcommitへ含めます。
8. push後、公開URLの `/release-manifest.json` で `gitCommit` が対象SHAと一致することを確認し、再度受け入れ確認します。

stampは適用そのものを自動証明するものではなく、作業者がその内容を本番へ適用・確認した記録です。内容が変われば必ず無効になります。CIにはDBパスワードやservice role keyを渡さず、フロントだけが先に出る事故を防ぎます。`--write-stamp` はコードレビューやローカルテストだけでは実行しません。

## 2026-09-15の修正と受け入れ確認

- PDF取り込みは `isEvalSupported: false` を必須にし、現在のPDF.jsでCVE-2024-4367の公式回避策を適用します。通常PDFの取り込みもブラウザで確認します。これはライブラリ全体を最新版へ更新したという意味ではありません。
- 生徒の下書きは、保存済み画像・動画・音声・背景をStorageから再取得して復元します。通信失敗時も下書きと保存先を保持し、画面に再試行の案内を表示します。新規挿入後、まだ一度も保存していない動画・音声本体の再読み込み復元は対象外です。保存完了後にページを閉じてください。
- フォーム回答は500件ずつ全件取得します。作成日時とIDを基準に取得し、取得途中のエラーでは不完全な集計を表示しません。
- 生徒の保存で発生する削除予約は所属クラスの教員へ割り当てます。古い生徒IDの予約も教員の後処理で回収し、クラス担当の変更時は現在の所属を照合します。24時間の猶予、参照中ファイルの保護、他クラスの除外は継続します。

`scripts/verify-cleanup-ownership.sql` は架空アカウントだけを作るトランザクション内で、上記の所有者・権限・担当変更を確認して全件rollbackします。Storageファイル本体は作成・削除しません。`scripts/verify-production-fixes-browser.cjs` は実Edgeで再読み込みとPDF描画を確認しますが、Storageは模擬実装です。認証済みの別端末での操作確認とは区別してください。

教員の保存等による既存の後処理は継続します。追加した定期実行workflowを有効化するまでは、誰も操作しない期間の削除完了時刻は保証しません。バックアップ取得・復元訓練は別途実施記録が必要です。漏洩パスワード防止は[Supabaseの公式説明](https://supabase.com/docs/guides/auth/password-security)でPro以上の機能とされており、この修正で有料プランへ変更しません。

本番のmigrationは `20260914231205_align_storage_cleanup_ownership.sql` です。CLIで作成したローカルmigrationをMCPで適用し、MCPが割り当てた履歴番号と同一SQLの適用結果を照合して、このファイル名へ揃えています。履歴のrepairは行っていません。適用前のrollback検証と適用後の同じ検証は成功しています。削除workerに必要な `service_role` の内部schema使用権限も、このmigrationで付与しています。

## バックアップの取得

保存先はリポジトリ外の新しい空フォルダーにします。フォルダー名にUTC日時とSupabase project refを入れます。CLIの版でオプションが変わり得るため、最初に次を実行します。

```powershell
npx supabase --version
npx supabase db dump --help
npx supabase storage cp --help
```

Supabase Access Token、DBパスワード等はコマンド履歴、ログ、ファイル名へ書かず、CLIログインまたは環境変数で渡します。値を表示する `echo` は使いません。`supabase status` はローカルstackの状態であり、linked本番projectの確認には使いません。リポジトリで `supabase/.temp/project-ref` を読み、Dashboard URLのproject refと一致することを二回確認します。バックアップ先へ移動せず、各コマンドをリポジトリルートから実行します。

`D:\EncryptedBackups\...` は決定した暗号化外部保管先の絶対パスへ置き換えます。Databaseはroles、schema、dataを別ファイルへ取得します。実際のフラグはインストール済みCLIのhelpに合わせます。

```powershell
npx supabase db dump --linked --role-only --file "D:\EncryptedBackups\class-whiteboard\roles.sql"
npx supabase db dump --linked --file "D:\EncryptedBackups\class-whiteboard\schema.sql"
npx supabase db dump --linked --data-only --use-copy --file "D:\EncryptedBackups\class-whiteboard\data.sql"
```

通常のCLI dumpはSupabase管理schemaをフィルターします。この三ファイルだけを、AuthユーザーとStorage設定を含む完全な災害復旧バックアップとは扱いません。特に `auth.users` の件数と、復元後にログインできるテストアカウントを復元訓練で確認します。含まれない場合は、公式の「Backup and Restore using the CLI」に従い、DashboardのConnectから得た接続先を使う完全移行手順へ切り替えます。その手順は接続文字列にDBパスワードを必要とするため、共有端末や記録されるシェルでは実行せず、保管先と秘密管理方法を決めてから行います。Auth provider、SMTP、redirect URL、Realtime publication、Edge Function secrets、API/JWT keysなどDB外の設定は別の暗号化された運用台帳へ記録し、SQL dumpには含まれると仮定しません。

続いて全Storage bucketの実体を取得します。先にDashboardのStorageでbucket一覧を記録し、各bucketを個別にコピーします。`BUCKET_NAME` は一覧にある名前へ置き換えます。

```powershell
npx supabase storage cp --help
npx supabase storage cp --experimental --recursive "ss:///BUCKET_NAME" "D:\EncryptedBackups\class-whiteboard\storage\BUCKET_NAME" --linked
```

取得後はファイル数と総バイト数をbucket別に記録し、空でない既知のファイルを数件開きます。SQL三ファイルとStorage全体にSHA-256一覧を作成し、その一覧自体もバックアップへ含めます。バックアップは暗号化された外部媒体または組織管理の暗号化クラウドへ二重化し、復号鍵は別の認証管理へ保管します。リポジトリ、GitHub Actions artifact、公開共有フォルダーには置きません。

## 復元訓練

本番projectへ直接復元しません。組織と地域が確認済みの空の復元テストprojectを作り、project refを二人または二回照合します。

1. 公式手順どおりroles、schema、dataを同一トランザクションで空projectへ適用し、エラーを無視せず記録します。
2. Authユーザー件数、publicテーブルの外部キー、ログイン可否を確認します。Authがdumpに含まれない取得方式だった場合、このバックアップは完全復旧用として合格にしません。
3. 運用台帳からAuth、SMTP、redirect URL、Realtime、Edge Function secretsを再設定します。新projectではJWT/API keyが変わるため、既存セッションの継続を前提にしません。
4. Storage bucketを元と同じpublic/private設定、ファイル上限、MIME設定で作成します。DB dumpの `storage.objects` metadataだけではファイル本体は戻りません。
5. `storage/<bucket>` の実体を、CLIの `storage cp --help` で確認したコピー方向でテストprojectへアップロードします。
6. DBのStorage metadata件数、bucket別ファイル数・総バイト数、SHA-256標本をバックアップ記録と比較します。
7. テスト用教員・生徒でログインし、ボード、フォーム、画像、動画、削除権限、別クラス分離を確認します。

復元コマンドは必ず空のtest projectを対象にし、本番project refが含まれていたら中止します。復元完了後も本番DNSや `public/js/app-config.js` をテストprojectへ向けません。

## 容量確認とGC

週1回と大きな授業の前後にDashboardのDatabase、Storage、Egress、Realtime Usageを記録します。StorageはFree枠1GBに近づく前に、bucket別の増加量と保持期限を確認します。

SQL Editorでは、次の読み取り専用SQLでbucket別の実体件数とmetadata上の容量を確認できます。

```sql
select bucket_id,
       count(*) as object_count,
       coalesce(sum((metadata ->> 'size')::bigint), 0) as total_bytes
from storage.objects
group by bucket_id
order by total_bytes desc;
```

削除は、既存の画面操作または検証済みEdge Functionを使い、まず対象件数とパスをdry run相当で記録します。参照中のboard asset、提出物、フォーム画像をSQLやStorage画面から直接一括削除しません。GC後はDB metadataとStorage実体の双方から対象が消え、現行ボードが開けることを確認します。保持期限と削除承認者が決まるまでは自動cronを登録しません。

通常の削除候補は24時間の猶予を付けてqueueへ入ります。owner scoped workerは、教師のボード保存、生徒削除、履歴削除が成功したときにfire-and-forgetで呼ばれ、認証済みownerの範囲だけを処理します。ログインだけでは起動しません。workerは削除直前にも現行DBからの参照を確認します。48時間以上残った未commit uploadを探すsweeperは通常のowner処理では動かず、`STORAGE_CLEANUP_SECRET` を持つ保守リクエストでだけ実行します。定期実行を有効化する場合は[設定手順](STORAGE_CLEANUP_AUTOMATION.md)に従います。設定だけを確認するreadinessでは、削除対象件数や本番への接続成功は検証しません。保持期限、担当者、通知先を決め、復元可能なバックアップを確認してから実行します。
