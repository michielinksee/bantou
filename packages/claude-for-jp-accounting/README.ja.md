# Claude for JP Accounting

日本の税理士事務所向け AI 自動仕訳プラグイン。

## 概要

Claude Code プラグインとして、税理士事務所の記帳業務を自動化する 5 つのスキルを提供します。

1. **仕訳分類（Tax Classifier）** — 3段階パイプライン（除外判定、記憶+キーワード、AI判定）で取引を勘定科目に分類。消費税区分にも対応
2. **CSV取込（CSV Importer）** — 弥生・freee・MF・銀行/カード明細の CSV を自動判別して取り込み
3. **修正記憶（Correction Memory）** — 税理士の修正を永久記憶し、同じ間違いを二度としない。使うほど賢く・安くなる
4. **月次締め（Monthly Closer）** — 勘定科目別集計・前月比異常検知付きの月次レポートを自動生成
5. **夜間バッチ（Nightly Batch）** — freee API 経由で全顧問先を一括処理。信頼度別に自動分類/要確認を振り分け

## はじめかた

```bash
claude plugin install jp-accounting
```

初期設定ウィザードを起動します：

```
/jp-accounting:setup
```

事務所の慣行に合わせた設定を 10 分程度のヒアリングで行います。

## 対応会計ソフト

| ソフト | CSV取込 | API連携 |
|---|---|---|
| freee | 対応 | OAuth API |
| 弥生会計 | 対応（形式A/B） | -- |
| MFクラウド会計 | 対応 | -- |
| TKC | 対応 | -- |
| 銀行/カード明細 | 対応（列マッピング） | -- |

## 最大の特長：修正記憶

税理士が行った修正はすべてローカルに永久保存され、全顧問先の将来の分類に自動適用されます。

- 導入1ヶ月目：約60% をキーワードで自動分類
- 導入6ヶ月目：約80% をキーワード＋記憶で自動分類
- 導入12ヶ月目：約90% が自動分類、API コスト大幅削減

記憶データは `~/.cockpit-mcp/memory.json` にローカル保存されます（クラウド送信なし）。

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `/jp-accounting:setup` | 事務所の初期設定 |
| `/jp-accounting:classify` | 単一取引の分類 |
| `/jp-accounting:import` | CSV ファイルの取込・分類 |
| `/jp-accounting:report` | 月次レポートの生成 |
| `/jp-accounting:correct` | 分類修正の登録 |
| `/jp-accounting:nightly` | 夜間バッチ処理の実行 |

## アーキテクチャ

本プラグインは `@kansei-link/cockpit` MCP サーバーを参照する Markdown + JSON ラッパーです。TypeScript コードは含まれず、スキル定義・コマンド定義・エージェント定義・設定 JSON のみで構成されています。

## ライセンス

Apache-2.0 — Copyright 2026 Synapse Arrows PTE. LTD.