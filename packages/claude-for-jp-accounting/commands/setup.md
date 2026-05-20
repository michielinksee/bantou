# /jp-accounting:setup

Initial firm onboarding. Conducts a guided interview to configure
the plugin for the tax accountant's office.

## Usage

```
/jp-accounting:setup
```

No arguments required. The command starts an interactive interview.

## Interview flow (approximately 10 minutes)

The setup agent asks the following 8 questions in sequence.
Each question adapts based on previous answers.

### Q1. Firm name (事務所名)

"事務所名を教えてください。"

### Q2. Client count (顧問先数)

"顧問先は何社ぐらいありますか？（概算で構いません）"

### Q3. Primary accounting software (メインの会計ソフト)

"メインで使っている会計ソフトを教えてください。"
Options: freee / 弥生会計 / MFクラウド / TKC / 複数併用

### Q4. Meal expense threshold (会議費・交際費の区分基準)

"飲食代の会議費/交際費の区分は、1人あたり何円を基準にしていますか？"
Default: ¥5,000 (tax law standard) or ¥10,000 (2024 revision)

### Q5. Overseas SaaS handling (海外SaaSの処理)

"海外SaaS（AWS, GitHub, Slack等）の仕訳ルールを教えてください。"
Covers: reverse charge, withholding tax, yen conversion timing

### Q6. Invoice system status (インボイス制度対応)

"適格請求書発行事業者の登録番号をお持ちですか？
免税事業者の顧問先はありますか？"

### Q7. Payroll processing (給与計算)

"給与計算も事務所で処理していますか？
使用している給与ソフトがあれば教えてください。"

### Q8. Report sharing method (レポート共有方法)

"顧問先へのレポート共有はどの方法がメインですか？"
Options: email / chatwork / LINE WORKS / Slack / PDF郵送

## Output

After the interview, the setup command:

1. Generates a customized `CLAUDE.md` from the standard baseline template
2. Configures the keyword dictionary based on the firm's conventions
3. Suggests freee/Yayoi API connection setup if applicable
4. Saves the firm profile to `data/firm-profile.json`

## Notes

- Setup can be re-run at any time to update the configuration
- All answers are stored locally, never sent to cloud services
- The generated CLAUDE.md can be manually edited afterward
