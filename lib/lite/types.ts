export type UiMode = 'full' | 'lite';
export type LiteRole = 'viewer';
export type LiteKind = 'expense' | 'received';

export interface UserProfileRow {
  user_id: string;
  display_name: string;
  ui_mode: UiMode;
  created_at: string;
}

export interface LiteShareRow {
  id: number;
  owner_id: string;
  viewer_id: string;
  role: LiteRole;
  created_at: string;
}

export interface LiteCategoryRow {
  id: number;
  user_id: string;
  name: string;
  kind: LiteKind;
  is_active: boolean;
  created_at: string;
}

export interface LitePayeeRow {
  id: number;
  user_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface LiteEntryRow {
  id: number;
  user_id: string;
  entry_date: string;
  kind: LiteKind;
  amount_minor: number;
  category_id: number | null;
  payee_id: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
