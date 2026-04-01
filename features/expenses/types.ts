export interface ReceiptItem {
  name: string;
  price: number;
  category: string;
}

export interface ReceiptData {
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
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
}

export interface AlertState {
  type: "success" | "error";
  message: string;
}
