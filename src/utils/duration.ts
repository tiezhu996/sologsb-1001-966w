import type { Cue, Locale } from '../types'

// 语速 1.0 时，各语言每秒可录制的字符数（忽略空白）
const BASE_RATES: Record<Locale, number> = {
  'zh-CN': 4.2,
  'en-US': 13.5,
  'ja-JP': 6.8,
}

const FALLBACK_RATE = 5

export const round1 = (value: number): number => Math.round(value * 10) / 10

/** 按目标文本、角色语速和当前语言估算录音秒数 */
export const estimateSeconds = (text: string, speed: number, locale: Locale): number => {
  const chars = text.replace(/\s+/g, '').length
  if (!chars) return 0
  const rate = (BASE_RATES[locale] ?? FALLBACK_RATE) * Math.max(0.3, speed || 1)
  return round1(chars / rate)
}

/**
 * 核对指纹：目标文本、原文、时间码、角色、语速和当前语言任一变化，
 * 指纹即改变，旧核对记录随之作废。
 */
export const cueFingerprint = (cue: Cue, locale: Locale): string =>
  [cue.target, cue.source, cue.start.toFixed(2), cue.end.toFixed(2), cue.actorId, cue.speed.toFixed(2), locale].join('␟')
