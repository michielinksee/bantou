import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-[var(--border)] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <CockpitLogo />
            <span className="text-lg">
              KanseiLink <span className="text-[var(--accent-dark)]">Cockpit</span>
            </span>
          </div>

          <div className="hidden items-center gap-7 text-sm text-[var(--text-body)] md:flex">
            <a href="#features" className="hover:text-[var(--foreground)]">機能</a>
            <a href="#layers" className="hover:text-[var(--foreground)]">3 つの差別化</a>
            <a href="#pricing" className="hover:text-[var(--foreground)]">料金</a>
            <a href="https://github.com/michielinksee/kansei-link-cockpit" className="hover:text-[var(--foreground)]">
              GitHub
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Link href="#waitlist" className="btn-secondary">早期登録</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-3xl">
            <span className="chip chip-blue mb-5">
              <span>◆</span>
              <span>v0.0.1-pre · MIT · Free MCP + Paid Dashboard</span>
            </span>

            <h1 className="text-[2.4rem] font-semibold leading-[1.1] tracking-tight md:text-[3.4rem]">
              税理士事務所の{" "}
              <span className="bg-gradient-to-r from-[var(--accent)] via-[var(--blue)] to-[var(--purple)] bg-clip-text text-transparent">
                AI 作業共有 layer
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-[1.05rem] leading-[1.75] text-[var(--text-body)]">
              Claude × freee で 顧問先 60 社を 1 人で回せる DIY 自動化を、{" "}
              <strong>5 分で install</strong> + チーム共同編集 + 顧問先共有 view。
              <br />
              MCP は <strong>OSS (無料)</strong>、 dashboard で課金。 <br />
              freee + Money Forward 横断、 Claude / GPT / Codex どれでも動く。
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="#waitlist" className="btn-primary">
                早期登録 (waitlist)
                <span aria-hidden>→</span>
              </Link>
              <a href="https://github.com/michielinksee/kansei-link-cockpit" className="btn-secondary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 .5C5.65.5.5 5.66.5 12.03c0 5.09 3.29 9.4 7.86 10.92.58.1.79-.25.79-.55 0-.28-.01-1.02-.02-2-3.2.69-3.87-1.54-3.87-1.54-.53-1.35-1.3-1.71-1.3-1.71-1.06-.73.08-.72.08-.72 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 2.9-.39c.99 0 1.99.13 2.9.39 2.21-1.5 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.68.42.36.79 1.08.79 2.17 0 1.57-.01 2.84-.01 3.23 0 .31.21.67.8.55A11.5 11.5 0 0 0 23.5 12.03C23.5 5.66 18.35.5 12 .5Z" />
                </svg>
                GitHub で見る
              </a>
            </div>

            <p className="mt-6 text-[0.92rem] text-[var(--text-muted)]">
              MCP は <code className="mono rounded bg-[var(--background-soft)] px-1.5 py-0.5 text-xs">npx -y @kansei-link/cockpit</code> で install。 dashboard 課金は 5/31 pilot 後 公開予定。
            </p>
          </div>
        </div>
      </section>

      {/* 3 差別化 (= Cockpit signature patterns) */}
      <section id="layers" className="relative border-t border-[var(--border)] bg-[var(--background-soft)]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-3xl">
            <div className="chip mb-4">Cockpit signature</div>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
              3 つの差別化 (Sleek 分析から確立)
            </h2>
            <p className="mt-4 text-[1rem] leading-relaxed text-[var(--text-body)]">
              SG の Sleek (= service-tech 累計 $20M funded) を 30 個 SaaS と並べて分析。 そこから抽出した
              「顧問先が 信頼で使い続ける」 UX を Cockpit core pattern に。
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <article className="card card-lg flex h-full flex-col p-7">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 text-2xl">
                👤
              </div>
              <div className="mono mt-4 text-xs uppercase tracking-widest text-[var(--accent-dark)]">
                Pattern 1
              </div>
              <h3 className="mt-2 text-[1.3rem] font-semibold leading-snug">
                「田中先生に質問」 + photo
              </h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-body)]">
                全 page 右上に 担当税理士の 顔写真 + 「質問する」 button が常駐。 顧問先は
                「software」 ではなく 「事務所のサービス」 として体験。
              </p>
            </article>

            <article className="card card-lg flex h-full flex-col p-7">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 text-2xl">
                📊
              </div>
              <div className="mono mt-4 text-xs uppercase tracking-widest text-[var(--accent-dark)]">
                Pattern 2
              </div>
              <h3 className="mt-2 text-[1.3rem] font-semibold leading-snug">
                価値 + 行動 2 KPI 並列
              </h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-body)]">
                「節税予測 ¥185K」 + 「確認推奨 ¥45K」 を上部 prominent。 billing 根拠 + 顧客
                motivation を 同時刺激。
              </p>
            </article>

            <article className="card card-lg flex h-full flex-col p-7">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 text-2xl">
                🗂
              </div>
              <div className="mono mt-4 text-xs uppercase tracking-widest text-[var(--accent-dark)]">
                Pattern 3
              </div>
              <h3 className="mt-2 text-[1.3rem] font-semibold leading-snug">
                Service-categorized nav
              </h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--text-body)]">
                「月次決算 / 年末調整 / 質問相談」 = 顧客が買ってる service 単位の nav。 「仕訳画面」 等の
                機能名 nav は捨てた。
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* 機能 (= 4 layer model 簡易版) */}
      <section id="features" className="relative border-t border-[var(--border)]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-3xl">
            <div className="chip mb-4">4 layer architecture</div>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
              Notion の workspace は持たない、 dashboard に集中
            </h2>
            <p className="mt-4 text-[1rem] leading-relaxed text-[var(--text-body)]">
              Claude / GPT / Anthropic Agents を engine として借り、 freee / Money Forward を data
              layer として借りる。 我々は <strong>L3 dashboard で課金</strong>、 残りの 3 layer は
              無料 OSS。
            </p>
          </div>

          <div className="mt-12 grid gap-4">
            <LayerRow
              label="L3"
              title="Cockpit Web Dashboard"
              status="💰 paid"
              desc="team + 顧客共有 view、 顧問先 photo、 月次レポート、 Phase 1 Security 込み"
            />
            <LayerRow
              label="L2"
              title="Claude / GPT / Codex / Gemini CLI"
              status="🆓 borrowed"
              desc="個人 AI workspace、 ユーザーが既に使ってる tool"
            />
            <LayerRow
              label="L1.5"
              title="@kansei-link/cockpit (= MCP server)"
              status="🆓 our OSS"
              desc="2-stage classifier + 7 除外 rule + cross-SaaS reconciliation + CLAUDE.md template"
            />
            <LayerRow
              label="L1"
              title="freee / Money Forward / 他 200+ SaaS MCP"
              status="🆓 vendor-provided"
              desc="data layer、 既存 vendor が公開してる"
            />
          </div>
        </div>
      </section>

      {/* Pricing 簡易 */}
      <section id="pricing" className="relative border-t border-[var(--border)] bg-[var(--background-soft)]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-3xl">
            <div className="chip mb-4">Free MCP / Paid Dashboard</div>
            <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
              MCP は 無料、 dashboard で課金
            </h2>
            <p className="mt-4 text-[1rem] leading-relaxed text-[var(--text-body)]">
              Solo 税理士は MCP free だけで DIY 自動化完結。 中規模事務所以上は dashboard 必須
              → tier 別 月額。
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3 lg:grid-cols-5">
            <PriceCard tier="Free" price="¥0" subtitle="OSS MCP のみ" />
            <PriceCard tier="Solo Pro" price="¥10K/月" subtitle="個人 dashboard" />
            <PriceCard tier="Team" price="¥30K/月" subtitle="5-10 スタッフ" popular />
            <PriceCard tier="Customer-facing" price="¥80K/月" subtitle="顧問先 view + Phase 1 Security" />
            <PriceCard tier="Enterprise" price="¥3K/顧問先/月" subtitle="SSO + on-prem + SLA" />
          </div>

          <p className="mt-8 text-center text-sm text-[var(--text-muted)]">
            5/31 pilot 1 firm 契約後に Founders' Edition (= 限定 10-20 firm、 ¥298K 一括 = Lifetime
            Solo Pro + 共著クレジット) 販売開始。
          </p>
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="relative border-t border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="chip chip-blue mb-4 inline-flex">早期登録</div>
          <h2 className="text-3xl font-semibold tracking-tight md:text-[2.2rem]">
            5/31 pilot 1 firm 契約獲得 → 段階的に open
          </h2>
          <p className="mt-4 text-[1rem] leading-relaxed text-[var(--text-body)]">
            まずは 5/15 baseline 完成 + early adopter 接触。 5/31 pilot で 数値 + ROI 数字確定。 6/10
            Online Demo Day で 10-20 firm waitlist 募集 → 7 月以降 onboarding。
          </p>
          <p className="mt-6 text-[0.92rem] text-[var(--text-muted)]">
            (= waitlist form は dashboard 基盤完成後、 5/19 以降 enable)
          </p>
          <a href="https://github.com/michielinksee/kansei-link-cockpit" className="btn-primary mt-8">
            GitHub で進捗を追う
            <span aria-hidden>→</span>
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--background-soft)]">
        <div className="mx-auto max-w-6xl px-6 py-10 text-center text-sm text-[var(--text-muted)]">
          © 2026 Synapse Arrows PTE. LTD. · KanseiLink Cockpit ·{" "}
          <a href="https://github.com/michielinksee/kansei-link-cockpit" className="underline hover:text-[var(--foreground)]">
            GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}

function CockpitLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="8.5" y="8.5" width="18" height="18" rx="3" stroke="#a78bfa" strokeWidth="2" />
      <rect x="5.5" y="5.5" width="18" height="18" rx="3" stroke="#6366f1" strokeWidth="2" />
    </svg>
  );
}

function LayerRow({
  label,
  title,
  status,
  desc,
}: {
  label: string;
  title: string;
  status: string;
  desc: string;
}) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className="mono shrink-0 rounded-md bg-[var(--background-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-dark)]">
        {label}
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3">
          <h3 className="text-[1.05rem] font-semibold">{title}</h3>
          <span className="text-xs text-[var(--text-muted)]">{status}</span>
        </div>
        <p className="mt-1 text-[0.92rem] text-[var(--text-body)]">{desc}</p>
      </div>
    </div>
  );
}

function PriceCard({
  tier,
  price,
  subtitle,
  popular,
}: {
  tier: string;
  price: string;
  subtitle: string;
  popular?: boolean;
}) {
  return (
    <article
      className={`card flex flex-col p-5 text-center ${
        popular ? "border-[var(--accent)] ring-2 ring-[var(--accent-light)]" : ""
      }`}
    >
      {popular ? (
        <span className="chip chip-blue self-center mb-3 text-[0.7rem]">推奨 main</span>
      ) : null}
      <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {tier}
      </h3>
      <div className="mt-2 text-2xl font-bold">{price}</div>
      <p className="mt-2 text-xs text-[var(--text-body)]">{subtitle}</p>
    </article>
  );
}
