// freee connection doctor — one-shot diagnostic for the three freee trip-wires:
//   ① token source   — FREEE_ACCESS_TOKEN env var vs the secrets file
//   ② token expiry    — 24h TTL, no auto-refresh
//   ③ which company_id — the "I have 4-5 test 事業所, which one is live?" problem
//
// Reads credentials at runtime; NEVER prints the access token.

import { loadFreeeSecrets, isTokenExpired, FreeeSecrets } from './secrets.js';
import { FreeeConnector } from './connectors/freee.js';

export interface FreeeDoctorReport {
  ok: boolean;
  stage?: string;
  token_source: {
    env_FREEE_ACCESS_TOKEN: 'set' | 'not set';
    env_FREEE_COMPANY_ID: string;
    env_FREEE_TOKEN_EXPIRES_AT: string;
    secrets_file: string;
  };
  token_expires_at?: string;
  token_expires_at_parseable?: boolean;
  token_expired_or_near?: boolean;
  note?: string;
  configured_company_id?: number | null;
  live_connection?: boolean;
  accessible_companies?: Array<{ id: number; display_name: string }>;
  live_error?: string;
  verdict?: string | null;
  action_required?: string | null;
  error?: string;
}

export async function runFreeeDoctor(): Promise<FreeeDoctorReport> {
  const env = process.env;
  const token_source = {
    env_FREEE_ACCESS_TOKEN: (env.FREEE_ACCESS_TOKEN ? 'set' : 'not set') as 'set' | 'not set',
    env_FREEE_COMPANY_ID: env.FREEE_COMPANY_ID || 'not set',
    // An env var here OVERRIDES the file (secrets.ts) — so a stale/malformed value set in the
    // shell can silently "revive" after you fix the file. Surfaced so that case is diagnosable.
    env_FREEE_TOKEN_EXPIRES_AT: env.FREEE_TOKEN_EXPIRES_AT || 'not set',
    secrets_file: '~/.claude/secrets/freee-cockpit-dev.json',
  };

  // ① — can we source a token at all? (company_id NOT required here — that's the whole point:
  //     you must be able to discover the right company_id WITHOUT already having one.)
  let secrets: FreeeSecrets;
  try {
    secrets = loadFreeeSecrets(undefined, { requireCompanyId: false });
  } catch (err: any) {
    return {
      ok: false,
      stage: 'token_load',
      token_source,
      error: err?.message ?? String(err),
      action_required:
        'No usable access token. Set FREEE_ACCESS_TOKEN (env / plugin settings) or create the secrets file, then re-run.',
    };
  }

  // ② — is the token alive?
  const expired = isTokenExpired(secrets);
  const expiresParseable =
    !!secrets.token_expires_at && !Number.isNaN(new Date(secrets.token_expires_at).getTime());
  const configured = Number.isFinite(secrets.company_id) ? secrets.company_id : null;

  const report: FreeeDoctorReport = {
    ok: true,
    token_source,
    token_expires_at: secrets.token_expires_at || '(not recorded — cannot pre-check expiry)',
    token_expires_at_parseable: expiresParseable,
    token_expired_or_near: expired,
    configured_company_id: configured,
  };
  if (secrets.token_expires_at && !expiresParseable) {
    report.note =
      'token_expires_at is present but NOT a parseable date (check for stray spaces, e.g. "16: 00: 00"). ' +
      'A malformed expiry silently defeats the pre-flight expiry check — fix the timestamp or just re-issue the token.';
  }

  // ③ — list every accessible 事業所 and validate the configured id against reality.
  try {
    const conn = new FreeeConnector(secrets, { skipExpiryCheck: true });
    const companies = await conn.listCompanies();
    report.live_connection = true;
    report.accessible_companies = companies.map((c) => ({ id: c.id, display_name: c.display_name }));

    if (configured === null) {
      report.action_required =
        'No company_id configured. Pick an id from accessible_companies and set FREEE_COMPANY_ID ' +
        '(or company_id in the secrets file).';
    } else if (!companies.some((c) => c.id === configured)) {
      report.action_required =
        `Configured company_id ${configured} is NOT accessible by this token — likely a dead/duplicate ` +
        `test company. Switch to one of the ids listed in accessible_companies.`;
    } else {
      report.verdict = `OK — token is live and company_id ${configured} is valid.`;
      report.action_required = null;
    }
  } catch (err: any) {
    report.ok = false;
    report.live_connection = false;
    report.live_error = err?.message ?? String(err);
    report.action_required = expired
      ? 'Token is expired/near-expiry. Re-issue at https://developer.freee.co.jp/ and update FREEE_ACCESS_TOKEN (or the secrets file).'
      : 'Could not list companies. If the error is 401, the token is invalid/expired — re-issue at https://developer.freee.co.jp/.';
  }

  return report;
}
