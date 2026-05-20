// Secrets loader for Cockpit MCP.
//
// Reads ~/.claude/secrets/freee-cockpit-dev.json for the freee Dev Sandbox
// access token + company ID. NEVER logs secret values.
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

export function loadFreeeSecrets(secretsPath: string = DEFAULT_SECRETS_PATH): FreeeSecrets {
  if (!fs.existsSync(secretsPath)) {
    throw new Error(
      `Freee secrets file not found at ${secretsPath}. ` +
      `See README for setup instructions.`
    );
  }

  const raw = fs.readFileSync(secretsPath, 'utf8');
  const data = JSON.parse(raw);

  // Field name normalization (= file uses freee_X prefix, return canonical)
  const secrets: FreeeSecrets = {
    access_token: data.freee_access_token || data.access_token,
    company_id: Number(data.freee_company_id || data.company_id),
    company_name: data.freee_company_name || data.company_name || '',
    token_expires_at: data.freee_token_expires_at || data.token_expires_at,
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

  // Validate required fields
  if (!secrets.access_token || secrets.access_token.startsWith('<')) {
    throw new Error('freee_access_token is missing or placeholder');
  }
  if (!secrets.company_id || isNaN(secrets.company_id)) {
    throw new Error('freee_company_id is missing or invalid');
  }

  return secrets;
}

export function isTokenExpired(secrets: FreeeSecrets, bufferMinutes: number = 5): boolean {
  if (!secrets.token_expires_at) return false; // unknown, assume valid
  try {
    const expiresAt = new Date(secrets.token_expires_at).getTime();
    const now = Date.now();
    const bufferMs = bufferMinutes * 60 * 1000;
    return expiresAt - now < bufferMs;
  } catch {
    return false;
  }
}
