export type Phase =
  | 'ingesting' | 'analyzing' | 'designing' | 'awaiting_design_approval'
  | 'developing' | 'reviewing' | 'awaiting_pr_merge' | 'deploying' | 'verifying'
  | 'reporting' | 'succeeded' | 'failed' | 'cancelled' | 'paused'

export interface DesignVersion {
  version: number
  markdown: string
  feedback?: string
  created_at: string
}

export interface WorkflowEvent {
  id: string
  kind: string
  message: string
  phase: Phase
  data: Record<string, unknown>
  created_at: string
}

export interface Workflow {
  id: string
  thread_id: string
  wrike_url: string
  title?: string
  phase: Phase
  current_design_version: number
  approved_design_version?: number
  pull_request_url?: string
  error?: string
  created_at: string
  updated_at: string
  designs?: DesignVersion[]
  events?: WorkflowEvent[]
  state?: Record<string, unknown>
}

export interface GitHubAccount {
  account: string
  ssh_key_path: string
  key_available: boolean
}

export type DesignProvider = 'codex' | 'claude'

export interface DesignProviderSettings {
  provider: DesignProvider
  availability: Record<DesignProvider, boolean>
}
