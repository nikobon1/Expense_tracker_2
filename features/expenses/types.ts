export interface ReceiptItem {
  name: string;
  price: number;
  category: string;
}

export interface ReceiptData {
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
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
