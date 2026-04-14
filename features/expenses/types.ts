export type ExpenseSourceType = "receipt" | "recurring";
export type RecurringFrequency = "daily" | "weekly" | "monthly";

export interface ReceiptItem {
  name: string;
  price: number;
  category: string;
}

export interface ReceiptData {
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
  currency: string;
  comment?: string | null;
}

export interface ReceiptDetails extends ReceiptData {
  id: number;
  total_amount: number;
  source?: string | null;
  telegram_file_id?: string | null;
}

export interface Expense {
  id: number;
  receiptId: number;
  date: string;
  store: string;
  item: string;
  price: number;
  category: string;
  currency?: string;
  sourceType?: ExpenseSourceType;
  recurringId?: number | null;
  recurringFrequency?: RecurringFrequency | null;
  canEdit?: boolean;
}

export interface RecurringExpensePlan {
  id: number;
  title: string;
  store_name: string;
  amount: number;
  currency: string;
  category: string;
  frequency: RecurringFrequency;
  start_date: string;
  end_date?: string | null;
  next_charge_date?: string | null;
  is_active: boolean;
}

export interface CreateRecurringExpensePayload {
  title: string;
  store_name: string;
  amount: number;
  currency: string;
  category: string;
  frequency: RecurringFrequency;
  start_date: string;
}

export interface AlertState {
  type: "success" | "error";
  message: string;
}
