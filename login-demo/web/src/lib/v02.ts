export interface KnowledgeEntry {
  id: string;
  source_type: string;
  deleted: boolean;
  deleted_at: string | null;
  title: string;
  snippet: string;
  title_zh: string;
  title_en: string;
  body_zh: string;
  body_en: string;
  auto_title_zh: string | null;
  auto_title_en: string | null;
  auto_body_zh: string | null;
  auto_body_en: string | null;
  sensitive: boolean;
  editable: boolean;
  edited: boolean;
  edited_zh: boolean;
  edited_en: boolean;
  source_changed: boolean;
  updated_at: string;
}
export interface ChatMessage {
  id: string;
  error: boolean;
  created_at: string;
  role: "user" | "assistant";
  text: string;
  citations: { id: string; title: string }[];
  guard: { ok: boolean; unknown_numbers: string[] } | null;
  import_job_id: string | null;
}
export interface Conversation {
  id: string;
  created_at?: string;
  messages: ChatMessage[];
}
export interface ImportJob {
  id: string;
  filename: string;
  kind: string;
  status: string;
  requires_model: boolean;
  rows: Record<string, string>[];
  errors: { row: number; field: string; message: string }[];
  model: string | null;
  notes_zh: string | null;
  notes_en: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}
