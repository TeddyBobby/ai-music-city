export interface Job {
  id: string;
  title?: string;
  kind: string;
  status: string;
  preset: string;
  precision: string;
  ode_steps: number;
  seed: number;
  params: Record<string, any>;
  artifacts: Record<string, any>;
  timing?: Record<string, any>;
  progress?: Record<string, any>;
  take?: Record<string, any>;
  error?: string;
  created_at: string;
  finished_at?: string;
  started_at?: string;
  position?: number;
  loras?: any[];
  [key: string]: any;
}
export type Settings = Record<string, any>;
export type Status = Record<string, any>;

export interface LyricAlignmentLine {
  text: string;
  at: number | null;
  end?: number;
  section?: string;
}

export interface LyricsAlignment {
  status: "idle" | "queued" | "running" | "ready" | "failed" | "unavailable";
  source: "audio";
  lines: LyricAlignmentLine[];
  message?: string;
  progress?: number;
  matched_lines?: number;
  total_lines?: number;
}
