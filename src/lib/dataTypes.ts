// Shared TypeScript shapes mirroring the Rust structs in
// `src-tauri/src/data/{commands,queries}.rs`. Keeping them in one
// place avoids drift between SettingsApp / overview cards / L2 capsule.

export type IngestStatus = {
  events_count: number;
  jsonl_files_watched: number;
  last_ingest_at: string | null;
  errors_today: number;
  claude_code_data_dir: string | null;
  claude_code_found: boolean;
  sources: SourceStatus[];
};

export type SourceStatus = {
  name: string;
  roots: string[];
  files_watched: number;
  events_count: number;
  last_ingest_at: string | null;
};

export type TokenSummary = {
  total_input: number;
  total_output: number;
  total_cache_read: number;
  total_cache_creation: number;
  total_cost_usd: string;
  session_count: number;
  dominant_model: string | null;
};

export type TimeseriesPoint = {
  bucket: string;
  tokens: number;
  cost_usd: string;
};

export type GroupRow = {
  key: string;
  tokens: number;
  percentage: number;
};

export type SessionRow = {
  session_id: string;
  started_at: string;
  total_tokens: number;
  cost_usd: string;
  model: string;
  project_path: string | null;
  source: string;
};

export type SettingsBundle = {
  claude_code_data_dir: string | null;
  claude_code_found: boolean;
  mute_window_start: string | null;
  mute_window_end: string | null;
  events_count: number;
};

export type SettingsPatch = {
  mute_window_start?: string | null;
  mute_window_end?: string | null;
};

export type Period = "today" | "week" | "month";
