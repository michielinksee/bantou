// Secrets loader for Cockpit MCP.
//
// Sources freee credentials with env winning over file: environment variables
// (FREEE_ACCESS_TOKEN / FREEE_COMPANY_ID — as declared in .mcp.json / plugin settings),
// then the secrets file ~/.claude/secrets/freee-cockpit-dev.json. NEVER logs secret values.
//
// Production deployment will source secrets from a different mechanism
// (= Cloudflare Worker secret store or env vars, not this filesystem path).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface FreeeSecrets {
  access_token: string;
  company_id: number;
  company_name: string;
  token_expires_at: string; // ISO 8601
  client_id?: string; // optional, for OAuth refresh
  client_secret?: string;
  refresh_token?: string;
}

const DEFAULT_SECRETS_PATH = path.join(
  os.homedir(),
  '.claude',
  'secrets',
  'freee-cockpit-dev.json'
);

export function loadFreeeSecrets(
  secretsPath: string = DEFAULT_SECRETS_PATH,
  opts: { requireCompanyId?: boolean } = {}
): FreeeSecrets {
  const requireCompanyId = opts.requireCompanyId !== false; // default: required

  // Source 1: the secrets file (now OPTIONAL — env vars are a valid alternative).
  let data: Record<string, any> = {};
  const fileExists = fs.existsSync(secretsPath);
  if (fileExists) {
    data = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  }

  // Source 2: environment variables (env wins over file).
  // This is what makes the documented FREEE_ACCESS_TOKEN / FREEE_COMPANY_ID actually take
  // effect — previously they were declared in .mcp.json / plugin settings but never read here.
  const env = process.env;
  if (env.FREEE_ACCESS_TOKEN) data.access_token = env.FREEE_ACCESS_TOKEN;
  if (env.FREEE_COMPANY_ID) data.company_id = env.FREEE_COMPANY_ID;
  if (env.FREEE_COMPANY_NAME) data.company_name = env.FREEE_COMPANY_NAME;
  if (env.FREEE_TOKEN_EXPIRES_AT) data.token_expires_at = env.FREEE_TOKEN_EXPIRES_AT;
  if (env.FREEE_CLIENT_ID) data.client_id = env.FREEE_CLIENT_ID;
  if (env.FREEE_CLIENT_SECRET) data.client_secret = env.FREEE_CLIENT_SECRET;
  if (env.FREEE_REFRESH_TOKEN) data.refresh_token = env.FREEE_REFRESH_TOKEN;

  // Neither source provided a token → fail with a message that names BOTH paths.
  if (!(data.freee_access_token || data.access_token)) {
    throw new Error(
      'freee access token not found. Provide it via the FREEE_ACCESS_TOKEN environment variable ' +
      '(plugin settings / .mcp.json), or in the secrets file at ' + secretsPath + ' ' +
      '(file ' + (fileExists ? 'present but missing access_token' : 'not found') + '). See README.'
    );
  }

  // Field name normalization (file may use the freee_X prefix; env uses canonical names).
  const secrets: FreeeSecrets = {
    access_token: data.freee_access_token || data.access_token,
    company_id: Number(data.freee_company_id || data.company_id),
    company_name: data.freee_company_name || data.company_name || '',
    token_expires_at: data.freee_token_expires_at || data.token_expires_at || '',
  };

  // Optional fields (TODO placeholders are filtered out)
  const optionalString = (v: any): string | undefined => {
    if (typeof v !== 'string') return undefined;
    if (v.startsWith('TODO') || v.startsWith('<') || v === '') return undefined;
    return v;
  };
  secrets.client_id = optionalString(data.freee_client_id || data.client_id);
  secrets.client_secret = optionalString(data.freee_client_secret || data.client_secret);
  secrets.refresh_token = optionalString(data.freee_refresh_token || data.refresh_token);

  // Validate
  if (!secrets.access_token || secrets.access_token.startsWith('<')) {
    throw new Error('freee access token is missing or placeholder');
  }
  if (requireCompanyId && (!secrets.company_id || isNaN(secrets.company_id))) {
    throw new Error(
      'freee company_id is missing or invalid. Run `npm run doctor:freee` (or the freee_doctor tool) ' +
      'to list accessible companies and pick the right id, then set FREEE_COMPANY_ID ' +
      '(or company_id in the secrets file).'
    );
  }

  return secrets;
}

export function isTokenExpired(secrets: FreeeSecrets, bufferMinutes: number = 5): boolean {
  if (!secrets.token_expires_at) return false; // unknown, assume valid
  const expiresAt = new Date(secrets.token_expires_at).getTime();
  // A malformed timestamp (e.g. stray spaces "16: 00: 00") yields NaN. Previously the NaN
  // comparison silently returned false ("not expired"), so the pre-flight guard never fired and
  // the caller got a cryptic raw 401 instead. Treat an unparseable expiry as expired.
  if (Number.isNaN(expiresAt)) return true;
  const bufferMs = bufferMinutes * 60 * 1000;
  return expiresAt - Date.now() < bufferMs;
}
