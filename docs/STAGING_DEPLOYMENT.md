# GitHub Pages + Supabase ステージング環境

## 構成

- GitHub Pages: `public/` の静的フロントエンド
- Supabase Auth: 教員・生徒ログイン
- Supabase Database: クラス、生徒、ボードメタデータ
- Supabase Storage: 非公開のボードデータ
- Supabase Realtime: 在席、チャット、画面確認、共同編集
- Supabase Edge Functions: 教員登録、クラス・生徒管理

`server.js` はローカル互換用です。GitHub Pagesでは実行されません。
ステージングでは実在する生徒の個人情報を登録せず、架空のテストデータだけを使用します。

## 無料枠向け設定

`public/js/app-config.js` で次の制限を有効にしています。

| 項目 | ステージング設定 |
| --- | ---: |
| 生徒一覧サムネイル | 12秒間隔 |
| 個別画面モニタリング | 8秒間隔 |
| ノート画像 | 12秒間隔 |
| 共有ボードの永続化 | 60秒間隔 |
| Realtime送信ペイロード | 180KB以下 |
| Realtime画像 | 約150KB以下へ自動圧縮 |

初期テストは、教員1名・生徒3名以内・1回45分以内を目安にします。画面確認、
個別モニタリング、ノート撮影は必要な時間だけ有効にしてください。

Supabase Freeの現在の主な上限は、Realtime 200同時接続、月200万メッセージ、
Storage 1GB、Egress 5GBです。最新値は公式の
[Billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase) と
[Realtime limits](https://supabase.com/docs/guides/realtime/limits) で確認してください。

## 初回デプロイ

1. Supabase DashboardのAuth設定で漏洩済みパスワード保護を有効にします。
2. ステージングでは新規教員登録が停止していることを確認します。再び有効にする場合だけ、
   `TEACHER_SIGNUP_ENABLED=true` と推測困難な `TEACHER_INVITE_CODE` を設定します。
3. GitHubへ変更をコミットして `main` へプッシュします。
4. GitHubリポジトリの **Settings → Pages → Build and deployment** で
   **Source: GitHub Actions** を選びます。
5. `Deploy staging frontend to GitHub Pages` workflowの完了を待ちます。
6. workflowに表示されるPages URLを開きます。

フロントに含まれるSupabase Project URLとPublishable keyは公開情報です。
`service_role`、Secret key、DBパスワード、Supabase Access Token、教師招待コードは
GitHubへ保存しません。将来migrationをGitHub Actionsから適用する場合は、これらを
GitHub Actions Secretsへ登録します。

## 小規模テスト手順

1. トップページから教員ログインを開きます。新規教員登録は停止されています。
2. 作成済みのテスト用教員アカウントでログインし、テストクラスを1つ作成します。
3. 架空のテスト生徒を2〜3名作成します。
4. 別タブまたは別端末から各生徒でログインします。
5. 次を順番に確認します。
   - 教員の接続中一覧に生徒が表示される
   - 教員・生徒間チャット
   - 生徒画面確認を5分程度
   - 1名だけ個別モニタリング
   - ボード保存、再読み込み
   - 共同編集の開始、停止
6. Supabase DashboardのUsageとRealtime Reportsを確認します。
7. テスト終了後は全タブを閉じ、不要なテストアカウントを残さないようにします。

## 本番へ進むとき

ステージングのデータを本番へコピーしません。別のSupabaseプロジェクトを作成し、
`supabase/migrations/` とEdge Functionsだけを適用します。本番用のProject URLと
Publishable keyへ切り替え、別URLで再度受け入れテストを行います。

## 公開停止

問題が見つかった場合はGitHubの **Settings → Pages** で公開を停止できます。
あわせて教師招待コードをローテーションし、必要ならSupabase Authのテストセッションを
終了してください。
