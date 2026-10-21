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
