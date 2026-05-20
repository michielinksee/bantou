import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ExclusionChecker } from '../exclusion-checker.js';

const DATA_DIR = path.resolve(__dirname, '../../../../../data');

function makeChecker() {
  return new ExclusionChecker(undefined, DATA_DIR);
}

describe('ExclusionChecker', () => {
  // Rule: ATM withdrawal
  it('should exclude ATM withdrawals', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 50000, memo: 'ATM出金', date: '2026-05-01' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('atm_withdrawal');
  });

  it('should exclude cash withdrawals (現金引出)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 30000, memo: '現金引出 コンビニ', date: '2026-05-01' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('atm_withdrawal');
  });

  // Rule: Salary payment
  it('should exclude salary payments (給与)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 250000, memo: '給与振込 5月分', date: '2026-05-25' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('salary_payment');
  });

  it('should exclude bonus payments (賞与)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 500000, memo: '賞与 夏季', date: '2026-06-15' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('salary_payment');
  });

  // Rule: Loan repayment
  it('should exclude loan repayments (借入金返済)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 100000, memo: '借入金返済 日本政策金融公庫', date: '2026-05-10' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('loan_repayment');
  });

  // Rule: Social insurance / tax
  it('should exclude social insurance (厚生年金)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 80000, memo: '厚生年金保険料', date: '2026-05-01' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('social_insurance_tax');
  });

  it('should exclude withholding tax (源泉所得税)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 50000, memo: '源泉所得税 納付', date: '2026-05-10' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('social_insurance_tax');
  });

  // Rule: Investment
  it('should exclude investment transactions (SBI証券)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 100000, memo: 'SBI証券 入金', date: '2026-05-01' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('investment');
  });

  it('should exclude crypto transactions', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 50000, memo: 'Bitflyer 購入', date: '2026-05-01' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('investment');
  });

  // Normal business expenses should NOT be excluded
  it('should NOT exclude Starbucks (normal business expense)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 500, memo: 'スターバックス 渋谷店', date: '2026-05-01' });
    expect(result.excluded).toBe(false);
  });

  it('should NOT exclude AWS (normal SaaS expense)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 8000, memo: 'AWS 月額利用料', date: '2026-05-01' });
    expect(result.excluded).toBe(false);
  });

  it('should NOT exclude taxi rides', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 3000, memo: 'タクシー 新宿駅', date: '2026-05-01' });
    expect(result.excluded).toBe(false);
  });

  // Edge cases
  it('should handle empty memo', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 1000, memo: '', date: '2026-05-01' });
    expect(result.excluded).toBe(false);
  });

  it('should exclude unknown debit (regex rule)', () => {
    const checker = makeChecker();
    const result = checker.check({ amount: 5000, memo: 'デビット 1234', date: '2026-05-01' });
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('unknown_debit');
  });

  // transfer_to_employee pattern
  it('should exclude salary transfer when employee list matches', () => {
    const checker = makeChecker();
    const employees = ['田中太郎', '鈴木花子'];
    const result = checker.check(
      { amount: 300000, memo: '振込 田中太郎', date: '2026-05-25' },
      employees,
    );
    expect(result.excluded).toBe(true);
    expect(result.rule_id).toBe('salary_payment');
  });

  // Metadata methods
  it('getVersion should return the rules version', () => {
    const checker = makeChecker();
    expect(checker.getVersion()).toBe('1.0.0');
  });

  it('getRulesCount should return 7', () => {
    const checker = makeChecker();
    expect(checker.getRulesCount()).toBe(7);
  });

  it('should throw when rules file is missing', () => {
    expect(() => new ExclusionChecker('/nonexistent/rules.json')).toThrow(
      /Exclusion rules not found/,
    );
  });
});
