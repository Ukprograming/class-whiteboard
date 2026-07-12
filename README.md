# Class Whiteboard

教員と生徒がリアルタイムにホワイトボード、画面確認、チャット、ノート画像を共有する
教室向けWebアプリです。

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
