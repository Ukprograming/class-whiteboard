# Class Whiteboard

教員と生徒がリアルタイムにホワイトボード、画面確認、チャット、フォーム、ノート画像を共有する
教室向けWebアプリです。

## 授業フォーム

教師画面の上部にあるフォームボタンから、自由記述・単一選択・複数選択の問題を
作成して保存できます。クラスへ配信すると、生徒画面に回答ダイアログが表示され、
教師画面では回答人数、選択問題の棒グラフ、自由記述の一覧をリアルタイムで確認できます。
受付を終了した結果は実施履歴から問題ごとに再表示できます。

利用前に、既存のSupabaseマイグレーション適用手順で
`supabase/migrations/20260830062951_add_class_forms.sql` を対象環境へ適用してください。

## ステージング構成

- Frontend: GitHub Pages
- Backend: Supabase Auth / Database / Storage / Realtime / Edge Functions
- Local legacy compatibility: Express / Socket.IO / GAS proxy

公開テストの準備と無料枠向けの運用条件は
[docs/STAGING_DEPLOYMENT.md](docs/STAGING_DEPLOYMENT.md) を参照してください。

## ローカル確認

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd start
```

`http://localhost:3000/` を開きます。

秘密鍵、DBパスワード、教師招待コード、実在する生徒の個人情報はリポジトリへ
コミットしないでください。
