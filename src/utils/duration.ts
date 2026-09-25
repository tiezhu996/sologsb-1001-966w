import type { Cue, DurationCheck, ExportBlocker, Locale } from '../types'

/** 基准语速（speed = 1 时）：中文/日文按字每秒，英文按词每秒 */
const BASE_RATE: Record<Locale, number> = {
  'zh-CN': 4,
  'en-US': 2.6,
  'ja-JP': 5.5,
}

/** 去掉空白后统计配音文本的朗读单位：英文按词，中/日文按字符 */
export const countSpeechUnits = (text: string, language: Locale): number => {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return 0
  if (language === 'en-US') return compact.split(' ').length
  return Array.from(compact.replace(/[\s\p{White_Space}]/gu, '')).length
}

/** 按目标文本、角色语速和当前语言估算录音秒数 */
export const estimateRecordingSeconds = (text: string, speed: number, language: Locale): number => {
  const units = countSpeechUnits(text, language)
  const rate = BASE_RATE[language] * Math.max(0.01, speed)
  return Math.round((units / rate) * 10) / 10
}

/**
 * 核对输入指纹：目标文本、时间码、角色、语速、语言任一改动即变化，
 * 存储的旧核对结果随之作废。
 */
export const buildCueSignature = (cue: Cue, language: Locale): string =>
  [language, cue.target, cue.start.toFixed(2), cue.end.toFixed(2), cue.actorId, cue.speed.toFixed(2)].join('|')

export const evaluateCue = (cue: Cue, language: Locale): Omit<DurationCheck, 'cueId' | 'signature' | 'checkedAt' | 'note'> => {
  const windowSeconds = Math.max(0, cue.end - cue.start)
  const units = countSpeechUnits(cue.target, language)
  const rate = Math.round(BASE_RATE[language] * 100) / 100
  const estimated = estimateRecordingSeconds(cue.target, cue.speed, language)
  const excess = estimated > windowSeconds ? Math.round((estimated - windowSeconds) * 10) / 10 : 0
  return {
    language,
    window: Math.round(windowSeconds * 100) / 100,
    units,
    rate: Math.round(rate * Math.max(0.01, cue.speed) * 100) / 100,
    estimated,
    overtime: excess > 0,
    excess,
  }
}

export const isCheckStale = (check: DurationCheck | undefined, cue: Cue | undefined, language: Locale): boolean => {
  if (!check || !cue) return true
  return buildCueSignature(cue, language) !== check.signature
}

/** 导出前检查：存在已作废待重算的核对、或未填写处理说明的超时项时，SRT 导出暂停 */
export const findExportBlockers = (
  cues: Cue[],
  checks: DurationCheck[] | undefined,
  language: Locale,
): ExportBlocker[] => {
  const byId = new Map((checks ?? []).map((check) => [check.cueId, check]))
  const blockers: ExportBlocker[] = []
  for (const cue of cues) {
    const check = byId.get(cue.id)
    if (!check || isCheckStale(check, cue, language)) {
      blockers.push({ cueId: cue.id, kind: 'stale' })
      continue
    }
    if (check.overtime && !check.note.trim()) blockers.push({ cueId: cue.id, kind: 'unresolved' })
  }
  return blockers
}
