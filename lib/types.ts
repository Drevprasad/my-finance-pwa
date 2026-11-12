export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';
export type AccountSubtype =
  | 'bank' | 'cash' | 'wallet' | 'investment' | 'fd' | 'system'
  | 'credit_card' | 'loan' | 'other';
export type TxnKind =
  | 'expense' | 'income' | 'transfer' | 'reversal' | 'opening' | 'trade' | 'dividend' | 'fee' | 'refund';

export interface AccountRow {
  id: number; name: string; type: AccountType; subtype: AccountSubtype;
  currency: string; is_active: boolean;
  credit_limit_minor: number | null; statement_day: number | null; due_day: number | null;
}
export interface CategoryRow {
  id: number; name: string; kind: 'income' | 'expense' | 'transfer';
  parent_id: number | null; is_active: boolean;
}
export interface RuleRow {
  id: number; name: string | null; search_term: string; payee_name: string | null;
  category_id: number | null; priority: number; is_active: boolean;
}
export interface PostingRow {
  id: number; txn_id: number; account_id: number; amount_minor: number;
  category_id: number | null;
  accounts: { name: string; type: AccountType } | null;
}
export interface TxnRow {
  id: number; txn_date: string; payee: string | null; narration: string | null;
  notes: string | null; kind: TxnKind; voided_at: string | null; postings: PostingRow[];
}
export interface BalanceRow {
  id: number; name: string; type: AccountType; subtype: AccountSubtype;
  balance_minor: number; is_active: boolean;
}
export interface SummaryCategory { category_id: number | null; name: string; amount_minor: number }
export interface SummaryPeriod { period: string; income_minor: number; expense_minor: number }
export interface DashboardSummary {
  income_minor: number; expense_minor: number;
  by_category: SummaryCategory[]; by_period: SummaryPeriod[];
}
export interface ImportFailure { row: number; reason: string }
export interface ImportResult {
  batch_id: number | null; inserted: number; skipped: number; failed: ImportFailure[];
}
export interface CanonicalRow {
  txn_date: string; amount_minor: number; narration: string;
  payee: string | null; ref: string | null;
}