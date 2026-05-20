// freee API connector for Cockpit MCP.
//
// Wraps the freee Accounting API. Auth via Bearer token from secrets.ts.
// All API calls return parsed JSON or throw with sanitized error messages
// (= NEVER includes the access token).

import https from 'node:https';
import { FreeeSecrets, isTokenExpired } from '../secrets.js';

const FREEE_API_BASE = 'api.freee.co.jp';
const FREEE_API_VERSION = '2020-06-15';

export interface FreeeCompany {
  id: number;
  display_name: string;
  tax_at_source_calc_type: number;
  contact_name: string;
  fiscal_yearmonth?: string;
  tax_method?: number;
  accounting_period_start?: string;
}

export interface FreeeDeal {
  id: number;
  company_id: number;
  issue_date: string; // YYYY-MM-DD
  type: 'income' | 'expense';
  partner_id: number | null;
  partner_name?: string;
  account_item_id?: number;
  tax_code?: number;
  ref_number?: string;
  amount: number;
  due_amount: number;
  status: 'unsettled' | 'settled';
  details: FreeeDealDetail[];
  description?: string;
  memo?: string;
}

export interface FreeeDealDetail {
  id: number;
  account_item_id: number;
  tax_code: number;
  amount: number;
  description?: string;
}

export interface FreeePartner {
  id: number;
  name: string;
  shortcut1?: string;
  shortcut2?: string;
}

export interface FreeeAccountItem {
  id: number;
  name: string;
  shortcut?: string;
  account_category?: string;
  account_category_id?: number;
  tax_code?: number;
  group_name?: string;
  available?: boolean;
}

export interface CreateDealInput {
  issue_date: string; // YYYY-MM-DD
  type: 'income' | 'expense';
  amount: number;
  account_item_id: number;
  tax_code?: number;
  partner_id?: number;
  ref_number?: string;
  description?: string; // becomes the memo on the detail line
}

export class FreeeConnector {
  private secrets: FreeeSecrets;

  constructor(secrets: FreeeSecrets) {
    this.secrets = secrets;
    if (isTokenExpired(secrets)) {
      throw new Error(
        'freee access token has expired or is about to expire. ' +
        'Please refresh manually until OAuth refresh flow is implemented. ' +
        'Re-issue token at https://developer.freee.co.jp/ and update ~/.claude/secrets/freee-cockpit-dev.json'
      );
    }
  }

  private request<T>(method: string, path: string, body?: any): Promise<T> {
    const options: https.RequestOptions = {
      hostname: FREEE_API_BASE,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${this.secrets.access_token}`,
        'Accept': 'application/json',
        'X-Api-Version': FREEE_API_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      } as Record<string, string>,
      timeout: 30000,
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let chunks = '';
        res.on('data', (chunk) => { chunks += chunk; });
        res.on('end', () => {
          try {
            const data = chunks ? JSON.parse(chunks) : {};
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data as T);
            } else {
              // Sanitize error: never echo body if it might contain sensitive data
              const errMessage = data.errors
                ? JSON.stringify(data.errors).slice(0, 300)
                : `HTTP ${res.statusCode}`;
              reject(new Error(`freee API ${method} ${path} failed: ${errMessage}`));
            }
          } catch (e: any) {
            reject(new Error(`freee API parse error: ${e.message}`));
          }
        });
      });
      req.on('error', (e) => reject(new Error(`freee API request error: ${e.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('freee API timeout (30s)'));
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * List all companies accessible by the current OAuth token.
   * Multi-company method: a single token grants access to 60+ companies.
   * freee API: GET /api/1/companies
   */
  async listCompanies(): Promise<FreeeCompany[]> {
    const data = await this.request<{ companies: FreeeCompany[] }>('GET', '/api/1/companies');
    return data.companies;
  }

  async getCompany(companyId?: number): Promise<FreeeCompany> {
    const id = companyId ?? this.secrets.company_id;
    const data = await this.request<{ company: FreeeCompany }>('GET', `/api/1/companies/${id}`);
    return data.company;
  }

  /**
   * List deals (取引) with optional filters.
   *
   * @param opts.company_id  Override company (default: from secrets). Required for multi-company batch.
   * @param opts.status      Filter by 'unsettled' (未処理) or 'settled' (処理済み).
   *                         Multi-company method: always fetch 'unsettled' to avoid reprocessing.
   */
  async listDeals(opts: {
    company_id?: number;
    type?: 'income' | 'expense';
    status?: 'unsettled' | 'settled';
    start_issue_date?: string; // YYYY-MM-DD
    end_issue_date?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<FreeeDeal[]> {
    const params = new URLSearchParams({
      company_id: String(opts.company_id ?? this.secrets.company_id),
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.start_issue_date ? { start_issue_date: opts.start_issue_date } : {}),
      ...(opts.end_issue_date ? { end_issue_date: opts.end_issue_date } : {}),
      limit: String(opts.limit ?? 20),
      offset: String(opts.offset ?? 0),
    });
    const data = await this.request<{ deals: FreeeDeal[] }>('GET', `/api/1/deals?${params}`);
    return data.deals;
  }

  /**
   * List partners (取引先) for a company.
   * @param opts.company_id  Override company (default: from secrets).
   */
  async listPartners(opts: { company_id?: number; limit?: number; offset?: number } = {}): Promise<FreeePartner[]> {
    const params = new URLSearchParams({
      company_id: String(opts.company_id ?? this.secrets.company_id),
      limit: String(opts.limit ?? 20),
      offset: String(opts.offset ?? 0),
    });
    const data = await this.request<{ partners: FreeePartner[] }>('GET', `/api/1/partners?${params}`);
    return data.partners;
  }

  async listAccountItems(opts: { limit?: number; offset?: number } = {}): Promise<FreeeAccountItem[]> {
    const params = new URLSearchParams({
      company_id: String(this.secrets.company_id),
    });
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    const data = await this.request<{ account_items: FreeeAccountItem[] }>(
      'GET',
      `/api/1/account_items?${params}`
    );
    return data.account_items;
  }

  async createPartner(name: string): Promise<FreeePartner> {
    const body = {
      company_id: this.secrets.company_id,
      name,
    };
    const data = await this.request<{ partner: FreeePartner }>('POST', '/api/1/partners', body);
    return data.partner;
  }

  async createDeal(input: CreateDealInput): Promise<FreeeDeal> {
    const body: any = {
      company_id: this.secrets.company_id,
      issue_date: input.issue_date,
      type: input.type,
      details: [
        {
          account_item_id: input.account_item_id,
          tax_code: input.tax_code ?? 0,
          amount: input.amount,
          ...(input.description ? { description: input.description } : {}),
        },
      ],
    };
    if (input.partner_id) body.partner_id = input.partner_id;
    if (input.ref_number) body.ref_number = input.ref_number;
    const data = await this.request<{ deal: FreeeDeal }>('POST', '/api/1/deals', body);
    return data.deal;
  }

  async getWalletTxns(opts: {
    walletable_type?: 'bank_account' | 'credit_card' | 'wallet';
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const params = new URLSearchParams({
      company_id: String(this.secrets.company_id),
      ...(opts.walletable_type ? { walletable_type: opts.walletable_type } : {}),
      ...(opts.start_date ? { start_date: opts.start_date } : {}),
      ...(opts.end_date ? { end_date: opts.end_date } : {}),
      limit: String(opts.limit ?? 20),
      offset: String(opts.offset ?? 0),
    });
    const data = await this.request<{ wallet_txns: any[] }>('GET', `/api/1/wallet_txns?${params}`);
    return data.wallet_txns;
  }

  get companyId(): number {
    return this.secrets.company_id;
  }

  get companyName(): string {
    return this.secrets.company_name;
  }
}
