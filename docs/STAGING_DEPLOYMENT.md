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
| 生徒一覧サムネイル（ホワイトボード・画面共有・ノート提出） | 5秒間隔 |
| 個別画面モニタリング | 3秒間隔 |
| ノート画像 | 一覧サムネイルに統合（5秒間隔） |
| 共有ボードの永続化 | 60秒間隔 |
| Realtime送信ペイロード | 180KB以下 |
| Realtime画像 | 約150KB以下へ自動圧縮 |

ノート提出では、カメラ起動直後と台形補正完了直後にも画像を送信します。
教員の生徒ホワイトボードへの描画は操作確定時だけ、画面共有・ノート画像への添削は
送信ボタンを押したときだけ送信し、いずれも定期送信しません。

複数教員テストは、まず教員2名・各クラス生徒3〜5名から始め、問題がなければ
全クラス合計30名以内まで段階的に増やします。1回45分以内を目安にし、画面確認、
個別モニタリング、ノート撮影は必要な時間だけ有効にしてください。各教員・生徒は
別端末または別ブラウザープロファイルでログインします。同じブラウザープロファイルの
複数タブで同じ役割の別アカウントを同時利用しないでください。

FreeのRealtimeはプロジェクト全体で毎秒100メッセージまでです。通常の個人ボードと
5秒間隔の一覧サムネイルを使う30名テストは上限内を見込めますが、複数クラスで全員が
同時に共同編集ボードへ連続描画すると、配信先ごとにメッセージ数が増えるため上限を
超える可能性があります。共同編集の負荷試験は、最初は1クラスまたは少人数ずつ行います。

Supabase Freeの現在の主な上限は、Realtime 200同時接続、月200万メッセージ、
Storage 1GB、Egress 5GBです。最新値は公式の
[Billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase) と
[Realtime limits](https://supabase.com/docs/guides/realtime/limits) で確認してください。

## 初回デプロイ

1. Supabase DashboardのAuth設定で漏洩済みパスワード保護を有効にします。
2. 複数教員テストのアカウント作成期間だけ、公開設定の
   `teacherSignupEnabled: true`、Edge Function secretの
   `TEACHER_SIGNUP_ENABLED=true`、推測困難な `TEACHER_INVITE_CODE` を設定します。
   必要な教員アカウントを作成したら、公開設定とEdge Function secretの両方を無効にします。
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

1. 授業開始前に、各教員が招待コードを使って教員アカウントを作成します。
2. 各教員が自分のアカウントでログインし、他の教員と異なるクラスコードで
   テストクラスを1つ作成します。
3. 各クラスへ架空のテスト生徒を3〜5名作成します。
4. 別端末または別ブラウザープロファイルから各教員・生徒でログインします。
5. まず2クラスで次を順番に確認します。
   - 教員の接続中一覧に生徒が表示される
   - 別クラスの教員・生徒・ボード・フォームが表示されない
   - 教員・生徒間チャット
   - 生徒画面確認を5分程度
   - 1名だけ個別モニタリング
   - ボード保存、再読み込み
   - 共同編集の開始、停止（最初は1クラスずつ）
6. 問題がなければ、全クラスの参加者合計を30名以内まで増やして同じ確認を行います。
7. Supabase DashboardのUsageとRealtime Reportsを確認します。
8. テスト終了後は全タブを閉じ、不要なテストアカウントを残さないようにします。

## 本番へ進むとき

ステージングのデータを本番へコピーしません。別のSupabaseプロジェクトを作成し、
`supabase/migrations/` とEdge Functionsだけを適用します。本番用のProject URLと
Publishable keyへ切り替え、別URLで再度受け入れテストを行います。

## 公開停止

問題が見つかった場合はGitHubの **Settings → Pages** で公開を停止できます。
あわせて教師招待コードをローテーションし、必要ならSupabase Authのテストセッションを
終了してください。
