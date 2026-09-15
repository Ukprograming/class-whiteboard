# Supabase Storage cleanup 自動実行の設定

この workflow は、削除待ちの Storage オブジェクトを6時間ごとに処理します。初期状態では無効です。Repository variable `STORAGE_CLEANUP_ENABLED` を `true` にしたときだけ、定期実行が動きます。

1回の起動では100件ずつ、最大5回（合計最大500件）まで処理します。500件まで処理しても残件がありそうな場合、Storage 削除の一部が失敗した場合、または通信が3回続けて失敗した場合は GitHub Actions が赤い失敗表示になります。ログには件数だけを出し、秘密値や個別の Storage パスは出しません。

DB側の既存保護は変わりません。cleanup job は登録後24時間以上待ち、claim の直前にも参照中でないことを再確認します。古い未参照 upload の探索対象は48時間より古いものです。

## 1. 専用 secret を作る

先に [バックアップ確認表](BACKUP_CHECKLIST.md) で保管先・保持期限・復元確認を決めます。実行には承認されたバックアップと削除方針が必要です。

PowerShell で次を実行すると、専用の秘密値を画面に表示せずクリップボードへコピーできます。

```powershell
$cleanupBytes = New-Object byte[] 32
$cleanupRng = [Security.Cryptography.RandomNumberGenerator]::Create()
$cleanupRng.GetBytes($cleanupBytes)
$cleanupRng.Dispose()
$cleanupSecret = [BitConverter]::ToString($cleanupBytes).Replace('-', '')
Set-Clipboard -Value $cleanupSecret
```

この同じ値を Supabase と GitHub の2か所に設定します。リポジトリやチャットには貼り付けないでください。
設定後は組織の秘密管理先へ保管し、クリップボードを空にしてPowerShellを閉じてください。

## 2. Supabase Edge Function secret を設定する

Supabase Dashboard で対象 project を開き、`Edge Functions` → `Secrets` を開きます。

1. `Add secret` を押します。
2. Name に `STORAGE_CLEANUP_SECRET` を入力します。
3. Value に手順1で作った値を入力し、保存します。

現在の `process-storage-cleanup` が本番へ配備済みなら、secret の追加だけで反映され、再 deploy は不要です。この文書と workflow の追加だけでは Edge Function の配備や本番設定変更は行われません。

## 3. GitHub Actions secrets を設定する

GitHub repository の `Settings` → `Secrets and variables` → `Actions` → `Secrets` を開きます。1行ずつ追加します。

1. Name: `STORAGE_CLEANUP_URL`
   Value: `https://PROJECT_REF.supabase.co/functions/v1/process-storage-cleanup`
2. Name: `STORAGE_CLEANUP_SECRET`
   Value: 手順1と同じ値

`PROJECT_REF` は Supabase project の Project ID に置き換えます。URLに query parameter や認証情報を加えないでください。

## 4. 通信しない設定確認を実行する

GitHub repository の `Actions` → `Process Supabase Storage cleanup` → `Run workflow` を開きます。

1. mode は初期値の `readiness` のまま実行します。
2. `configuration is ready; no cleanup request was sent.` と表示され、緑色で終了することを確認します。

`readiness` は URL と secret の設定形式だけを確認します。Supabase へのリクエストや削除処理は行いません。

## 5. 手動で1回実行する

同じ `Run workflow` 画面で mode を `run` にして実行します。ここでは、24時間の猶予を過ぎ、参照がないとDBで再確認された対象が実際に削除されます。

成功時は各 batch と合計の件数だけが表示されます。失敗した場合は workflow のログから次を確認します。

- `cleanup job(s) failed`: Storage 削除または完了記録の一部が失敗しました。job はDB側の待機時間後に再試行できます。
- `request failed`: 一時的な通信失敗です。runner は最大3回まで自動再試行します。
- `safety cap; due jobs may remain`: 1回の上限500件に達しました。原因を確認し、必要なら手動で再実行します。
- `HTTP 401` / `HTTP 403`: Supabase と GitHub の `STORAGE_CLEANUP_SECRET` が同じか確認します。

## 6. 定期実行を有効にする

手動実行が成功してから、GitHub repository の `Settings` → `Secrets and variables` → `Actions` → `Variables` を開きます。

1. `New repository variable` を押します。
2. Name に `STORAGE_CLEANUP_ENABLED` を入力します。
3. Value に `true` を入力して保存します。

UTC の `17 */6 * * *` で起動するため、日本時間ではおおむね 03:17、09:17、15:17、21:17 です。GitHub Actions の混雑時は開始が遅れることがあります。

止めるときは `STORAGE_CLEANUP_ENABLED` を `false` にするか削除します。secret を更新するときは、Supabase と GitHub の値を同時に更新した後、もう一度 `readiness` と手動 `run` を実行します。

## 7. 失敗通知と稼働確認

GitHubの個人設定 `Settings` → `Notifications` → `Actions` で、担当者が失敗したworkflowの通知を受け取る設定にします。このworkflow自体からメール等は送信しません。通知が届くことを担当者が確認し、週1回はActions画面で最終成功日時を確認してください。workflowの停止や未起動は、処理の失敗通知だけでは検出できません。

`readiness` の成功は秘密値がSupabaseと一致する証明ではありません。また、通信タイムアウト後はサーバー側の処理が続いている場合があります。DBの再取得待機時間（15分）を考慮し、連続で手動起動せず実行結果と削除待ちを確認します。

## ローカル確認

runner の回帰テストは実HTTP mock serverを起動し、成功、部分失敗、通信再試行、batch上限とbacklog表示、500件上限を確認します。

```powershell
node scripts/test-storage-cleanup-runner.mjs
```
