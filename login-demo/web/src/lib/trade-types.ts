import type { Schema } from "./api";
export type Me = { id: number; email: string };
export type Company = {
  id: number;
  name: string;
  website: string;
  contact_name: string;
  contact_email: string;
  address: string;
  industry: string;
  products: string;
  target_region: string;
  agent_identity_md: string;
};
export type Customer = {
  id: number;
  name: string;
  contact: string;
  country: string;
  tier: string;
  email: string;
  backup_email: string;
  phone: string;
  whatsapp: string;
  wechat: string;
  company_website: string;
  linkedin_url: string;
  title: string;
  source: string;
  buyer_type: string;
  follow_up_note: string;
  main_category: string;
  match_score: number;
  note: string;
  social_media: Record<string, string>;
  libraries?: Library[];
  orders?: TradeOrder[];
};
export type CustomerPage = { items: Customer[]; total: number };
export type TradeOrderItem = {
  product_name: string;
  quantity: string | null;
  unit: string;
  unit_price: string | null;
  total_amount?: string | null;
};
export type TradeOrder = {
  id: number;
  customer_id: number;
  customer_name: string;
  order_no: string;
  currency: string;
  status: string;
  delivery_date: string;
  payment_terms: string;
  notes: string;
  created_at: string;
  total_amount: string | null;
  items: TradeOrderItem[];
};
export type Library = {
  id: number;
  name: string;
  description: string;
  root_path: string;
  file_count: number;
};
export type DocumentFile = {
  id: number;
  library_id: number;
  filename: string;
  size: number;
  extraction_note: string;
  created_at: string;
};
export type DocumentText = { id: number; filename: string; text: string; note: string };
export type Template = { id: number; name: string; content: string };
export type Skill = { id: string; name: string; description: string; category: string };
export type ModelSettings = { provider: string; model: string; has_key: boolean };
export type TradeMessage = { id?: number; role: string; content: string; skill_id?: string; status?: string };
export type TradeConversation = {
  id: number;
  title: string;
  customer_id: number | null;
  customer_name?: string;
  updated_at: string;
  skill_id?: string;
  messages?: TradeMessage[];
};
export type Automation = {
  id: number;
  name: string;
  prompt: string;
  skill_id: string;
  frequency: string;
  time_of_day: string;
  weekday: number;
  enabled: boolean;
  next_run_at: string;
};
export type AutomationRun = {
  id: number;
  automation_id: number;
  automation_name: string;
  status: string;
  output: string;
  error: string;
  started_at: string;
  finished_at: string;
};
export type ResearchReport = {
  id: number;
  query: string;
  status: string;
  answer: string;
  error: string;
  created_at: string;
  customer_name: string;
  sources: { title: string; url: string; content?: string }[];
  details: {
    layers?: Record<string, unknown>;
    flags?: string[];
    recommendations?: string[];
    overall_rating?: string;
    overall_score?: number;
  };
};
export type ImpactBrief = Pick<
  Schema<"ImpactDetail">,
  | "order_id"
  | "product"
  | "hts10"
  | "incoterm"
  | "status"
  | "risk_level"
  | "tag"
  | "profit_delta_usd"
  | "rate_baseline_user_pct"
  | "rate_new_pct"
  | "countdown"
  | "decision"
>;
export type TariffLink = {
  tariff_order_id: string;
  customer_id: number | null;
  customer_name: string | null;
  order_id: number | null;
  order_no: string | null;
  item_position: number | null;
  item_name: string;
};
export type TariffImpact = {
  tariff_order_id: string;
  item_position?: number;
  item_name?: string;
  stale?: boolean;
  order_id?: number;
  order_no?: string;
  impact: ImpactBrief | null;
};
export type TariffDraft = {
  order: TradeOrder;
  rows: {
    item_position: number;
    product_name: string;
    tariff_order_id: string;
    existing: boolean;
    stale: boolean;
    values: Record<string, string | number>;
  }[];
  hts_options: { hts10: string; desc: string; mfn_pct: number }[];
};
export type TariffSummary = {
  opened: boolean;
  meta?: Schema<"Meta">;
  brief?: { date: string; conclusion: string } | null;
  urgent?: (ImpactBrief & { customer_id: number | null; customer_name: string | null })[];
  watch_count?: number;
};
