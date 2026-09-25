export type CueStatus = 'draft' | 'reviewed' | 'issue'
export type Locale = 'zh-CN' | 'en-US' | 'ja-JP'

export interface Cue {
  id: string
  start: number
  end: number
  source: string
  target: string
  actorId: string
  speed: number
  termIds: string[]
  status: CueStatus
  locked: boolean
}

export interface Actor {
  id: string
  name: string
  color: string
  localeHint: string
}

export interface Term {
  id: string
  source: string
  target: string
  note: string
}

export interface Snapshot {
  id: string
  name: string
  createdAt: number
  cues: Cue[]
}

export interface DurationCheck {
  cueId: string
  /** 核对时的输入指纹：语言、目标文本、时间窗、角色、语速任一变化即与当前不匹配，核对作废 */
  signature: string
  language: Locale
  window: number
  units: number
  rate: number
  estimated: number
  overtime: boolean
  excess: number
  checkedAt: number
  /** 超时处理说明：未填写时视为未处理超时项，SRT 导出暂停 */
  note: string
}

export interface ExportBlocker {
  cueId: string
  kind: 'stale' | 'unresolved'
}

export interface EditorDocument {
  id: string
  title: string
  language: Locale
  cues: Cue[]
  actors: Actor[]
  terms: Term[]
  snapshots: Snapshot[]
  durationChecks: DurationCheck[]
  updatedAt: number
  revision: number
  lastWriter: string
}

export interface CueConflict {
  cueId: string
  type: 'actor' | 'tone' | 'address'
  message: string
}

export interface HistoryEntry {
  label: string
  cues: Cue[]
  selectedCueId: string | null
}
