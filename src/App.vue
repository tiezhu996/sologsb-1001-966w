<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Clock, Delete, DocumentCopy, Download, EditPen, Files, Lock, MagicStick, Monitor,
  RefreshLeft, RefreshRight, Search, Unlock, UploadFilled, VideoPlay,
} from '@element-plus/icons-vue'
import { useEditorStore } from './store/editor'
import type { Cue, CueConflict, DurationCheck, Locale } from './types'
import { formatTime } from './utils/subtitle'
import { estimateRecordingSeconds, isCheckStale } from './utils/duration'

const store = useEditorStore()
const { document: project, selectedCue, selectedCueId, visibleCues, saveState, conflict, online, timelineZoom, actorFilter } = storeToRefs(store)
const fileInput = ref<HTMLInputElement>()
const snapshotDialog = ref(false)
const snapshotName = ref('')
const search = ref('')
type CenterView = 'cues' | 'duration'
type DurationRow = { cue: Cue; check: DurationCheck | undefined; stale: boolean; live: number; liveRate: number }
const BASE_RATE: Record<Locale, number> = { 'zh-CN': 4, 'en-US': 2.6, 'ja-JP': 5.5 }
const centerView = ref<CenterView>('cues')
const exportBlockDialog = ref(false)

const filteredCues = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return visibleCues.value
  return visibleCues.value.filter((cue) => `${cue.source} ${cue.target}`.toLowerCase().includes(query))
})
const selectedWarnings = computed(() => selectedCue.value ? cueWarnings(selectedCue.value) : [])
const selectedTermMismatches = computed(() => selectedCue.value ? termMismatches(selectedCue.value) : [])
const totalCharacters = computed(() => project.value.cues.reduce((sum, cue) => sum + cue.source.length + cue.target.length, 0))
const saveLabel = computed(() => ({
  saved: store.t('saved'), dirty: store.t('dirty'), saving: store.t('saving'), conflict: store.t('conflict'),
}[saveState.value]))
const actorColor = (id: string) => project.value.actors.find((actor) => actor.id === id)?.color ?? '#6d7b91'
const actorName = (id: string) => project.value.actors.find((actor) => actor.id === id)?.name ?? '—'
const statusLabel = (status: Cue['status']) => store.t(status)
const statusType = (status: Cue['status']) => status === 'reviewed' ? 'success' : status === 'issue' ? 'danger' : 'info'

function updateSelected(patch: Partial<Cue>, label = 'update-cue') {
  if (selectedCue.value) store.updateCue(selectedCue.value.id, patch, label)
}
function tone(text: string) {
  const polite = (text.match(/您|请|劳驾|麻烦|敬请/g) ?? []).length
  const casual = (text.match(/你|咱们|[？?]$/g) ?? []).length
  if (polite > casual) return 'polite'
  if (casual > polite) return 'casual'
  return 'neutral'
}
function addressee(text: string) {
  const matches = text.match(/林博士|陈工|主持人|博士|老师|先生|女士|团队/g)
  return matches?.[0] ?? ''
}
function cueWarnings(cue: Cue): CueConflict[] {
  const index = project.value.cues.findIndex((item) => item.id === cue.id)
  const previous = project.value.cues[index - 1]
  const next = project.value.cues[index + 1]
  const warnings: CueConflict[] = []
  if (!previous) return warnings
  if (previous.actorId !== cue.actorId) warnings.push({ cueId: cue.id, type: 'actor', message: store.t('actorSwitch', { from: actorName(previous.actorId), to: actorName(cue.actorId) }) })
  const fromTone = tone(previous.target || previous.source)
  const currentTone = tone(cue.target || cue.source)
  if (fromTone !== 'neutral' && currentTone !== 'neutral' && fromTone !== currentTone) warnings.push({ cueId: cue.id, type: 'tone', message: store.t('toneSwitch', { from: fromTone, to: currentTone }) })
  const fromAddress = addressee(previous.source)
  const currentAddress = addressee(cue.source)
  if (fromAddress && currentAddress && fromAddress !== currentAddress) warnings.push({ cueId: cue.id, type: 'address', message: store.t('speakerSwitch', { from: fromAddress, to: currentAddress }) })
  if (!next) return warnings
  return warnings
}
function termMismatches(cue: Cue) {
  return project.value.terms.filter((term) => cue.termIds.includes(term.id) && cue.target && !cue.target.includes(term.target))
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const count = store.importText(await file.text(), file.name)
    ElMessage.success(store.t('importDone', { count }))
  } catch {
    ElMessage.error(store.t('importError'))
  } finally {
    input.value = ''
  }
}
function requestDelete(id: string) {
  ElMessageBox.confirm(store.t('confirmDelete'), { type: 'warning', confirmButtonText: store.t('delete') })
    .then(() => store.deleteCue(id))
    .catch(() => undefined)
}
const durationRows = computed(() => filteredCues.value.map((cue) => {
  const check = store.durationCheckMap.get(cue.id)
  const stale = isCheckStale(check, cue, project.value.language)
  return {
    cue,
    check: stale ? undefined : check,
    stale,
    live: estimateRecordingSeconds(cue.target, cue.speed, project.value.language),
    liveRate: Math.round(BASE_RATE[project.value.language] * cue.speed * 100) / 100,
  }
}))
const rateUnit = computed(() => project.value.language === 'en-US' ? store.t('dcUnitWord') : store.t('dcUnitChar'))
const blockerSummary = computed(() => {
  const blockers = store.exportBlockers
  const stale = blockers.filter((item) => item.kind === 'stale').length
  const unresolved = blockers.length - stale
  return { stale, unresolved }
})
function rowWindow(row: DurationRow) {
  return Math.max(0, Math.round((row.cue.end - row.cue.start) * 100) / 100)
}
function statusTag(check: DurationCheck | undefined, stale: boolean) {
  if (stale || !check) return { type: 'warning' as const, text: stale && check ? store.t('dcStatusStale') : store.t('dcStatusNone') }
  if (check.overtime) return { type: 'danger' as const, text: store.t('dcStatusOvertime', { excess: check.excess }) }
  return { type: 'success' as const, text: store.t('dcStatusOk') }
}
function onDurationRowClick(row: DurationRow) {
  store.selectCue(row.cue.id)
}
function durationRowClass(data: { row: DurationRow }) {
  return `dc-row${data.row.check?.overtime ? ' overtime' : ''}${data.row.stale ? ' stale' : ''}`
}
function runAllChecks() {
  store.runDurationCheck()
}
function runRowCheck(id: string) {
  store.runDurationCheck([id])
}
function onNoteInput(id: string, value: unknown) {
  store.setDurationNote(id, String(value))
}
function requestExportSrt() {
  if (store.exportBlockers.length) {
    exportBlockDialog.value = true
    return
  }
  store.exportSrt()
}
function goRecheck() {
  exportBlockDialog.value = false
  centerView.value = 'duration'
  runAllChecks()
}
function goDurationSheet() {
  exportBlockDialog.value = false
  centerView.value = 'duration'
}
function createSnapshot() {
  store.createSnapshot(snapshotName.value)
  snapshotName.value = ''
  snapshotDialog.value = false
  ElMessage.success(store.t('savedNow'))
}
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
  const key = event.key.toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 'z') {
    event.preventDefault(); event.shiftKey ? store.redo() : store.undo(); return
  }
  if ((event.metaKey || event.ctrlKey) && key === 'y') { event.preventDefault(); store.redo(); return }
  const list = filteredCues.value
  const index = list.findIndex((cue) => cue.id === store.selectedCueId)
  if (key === 'j') { event.preventDefault(); store.selectCue(list[Math.min(list.length - 1, index + 1)]?.id ?? null); nextTick(() => document.querySelector('.cue-row.active')?.scrollIntoView({ block: 'nearest' })) }
  if (key === 'k') { event.preventDefault(); store.selectCue(list[Math.max(0, index - 1)]?.id ?? null); nextTick(() => document.querySelector('.cue-row.active')?.scrollIntoView({ block: 'nearest' })) }
  if ((key === 'a' || key === 's') && selectedCue.value) store.markStatus(selectedCue.value.id, 'reviewed')
  if (key === 'x' && selectedCue.value) store.markStatus(selectedCue.value.id, 'issue')
  if (key === 'l' && selectedCue.value) store.toggleLock(selectedCue.value.id)
}
function setOnline(value: boolean) {
  store.setOnline(value)
  ElMessage({ message: store.t(value ? 'online' : 'offline'), type: value ? 'success' : 'warning' })
}
onMounted(async () => {
  await store.initialize()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  await nextTick()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})
const handleOnline = () => setOnline(true)
const handleOffline = () => setOnline(false)
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><Monitor /></div>
        <div>
          <h1>{{ store.t('appTitle') }}</h1>
          <p>{{ store.t('subtitle') }}</p>
        </div>
      </div>
      <div class="top-actions">
        <el-select v-model="project.language" size="small" class="language-select" @change="store.setLocale">
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en-US" />
          <el-option label="日本語" value="ja-JP" />
        </el-select>
        <span class="save-state" :class="saveState"><i />{{ saveLabel }}</span>
        <input ref="fileInput" class="file-input" type="file" accept=".srt,.txt,text/plain" @change="importFile" />
        <el-button :icon="UploadFilled" @click="fileInput?.click()">{{ store.t('import') }}</el-button>
        <el-button :icon="Download" @click="requestExportSrt">{{ store.t('export') }}</el-button>
        <el-button type="primary" :icon="DocumentCopy" @click="snapshotDialog = true">{{ store.t('snapshot') }}</el-button>
      </div>
    </header>

    <div v-if="!online" class="network-banner offline">{{ store.t('offline') }}</div>

    <div v-if="conflict" class="conflict-banner">
      <div>
        <strong>{{ store.t('conflictTitle') }}</strong>
        <span>{{ store.t('conflictBody') }}</span>
      </div>
      <div class="conflict-actions">
        <el-button size="small" @click="store.loadLatest">{{ store.t('loadLatest') }}</el-button>
        <el-button size="small" type="danger" @click="store.keepMine">{{ store.t('keepMine') }}</el-button>
      </div>
    </div>

    <main class="workspace">
      <aside class="left-panel panel">
        <section>
          <div class="section-heading">
            <span><el-icon><Files /></el-icon>{{ store.t('actors') }}</span>
            <small>{{ project.actors.length }}</small>
          </div>
          <button class="actor-filter" :class="{ active: actorFilter === 'all' }" @click="actorFilter = 'all'">
            <span class="actor-dot all" />{{ store.t('allActors') }}
            <b>{{ project.cues.length }}</b>
          </button>
          <button v-for="actor in project.actors" :key="actor.id" class="actor-filter" :class="{ active: actorFilter === actor.id }" @click="actorFilter = actor.id">
            <span class="actor-dot" :style="{ background: actor.color }" />{{ actor.name }}
            <b>{{ project.cues.filter((cue) => cue.actorId === actor.id).length }}</b>
          </button>
        </section>
        <section>
          <div class="section-heading"><span><el-icon><EditPen /></el-icon>{{ store.t('terms') }}</span><small>{{ project.terms.length }}</small></div>
          <div v-for="term in project.terms" :key="term.id" class="term-card">
            <div><b>{{ term.source }}</b><span>→ {{ term.target }}</span></div>
            <small>{{ term.note }}</small>
          </div>
          <p class="section-note">{{ store.t('termHint') }}</p>
        </section>
      </aside>

      <section class="center-panel">
        <div class="project-strip">
          <div>
            <el-input v-model="project.title" class="title-input" @input="store.markChanged('title')" />
            <div class="project-meta">
              <span>{{ store.t('cueCount', { count: project.cues.length }) }}</span>
              <span>{{ store.t('characterCount', { count: totalCharacters }) }}</span>
              <span>revision {{ project.revision }}</span>
            </div>
          </div>
          <div class="history-actions">
            <el-button-group>
              <el-button :icon="RefreshLeft" :disabled="!store.past.length" @click="store.undo">{{ store.t('undo') }}</el-button>
              <el-button :icon="RefreshRight" :disabled="!store.future.length" @click="store.redo">{{ store.t('redo') }}</el-button>
            </el-button-group>
          </div>
        </div>

        <div class="view-switch">
          <el-radio-group v-model="centerView" size="small">
            <el-radio-button value="cues">{{ store.t('viewCues') }}</el-radio-button>
            <el-radio-button value="duration">
              {{ store.t('viewDuration') }}
              <i v-if="store.staleCheckCount || store.unresolvedOvertimeCount" class="view-badge" :class="{ alert: store.unresolvedOvertimeCount }">{{ store.staleCheckCount + store.unresolvedOvertimeCount }}</i>
            </el-radio-button>
          </el-radio-group>
        </div>

        <template v-if="centerView === 'cues'">
        <div class="timeline-card">
          <div class="section-heading">
            <span><el-icon><Clock /></el-icon>{{ store.t('timeline') }}</span>
            <div class="zoom-control"><small>{{ store.t('zoom') }}</small><el-slider v-model="timelineZoom" :min="0.7" :max="3" :step="0.1" /></div>
          </div>
          <div class="timeline-scroll">
            <div class="timeline" :style="{ width: `${timelineZoom * 100}%` }">
              <button
                v-for="cue in filteredCues" :key="cue.id" class="timeline-block" :class="{ active: cue.id === selectedCueId, issue: cue.status === 'issue', locked: cue.locked }"
                :style="{ left: `${(cue.start / store.totalDuration) * 100}%`, width: `${Math.max(1.8, ((cue.end - cue.start) / store.totalDuration) * 100)}%`, borderColor: actorColor(cue.actorId) }"
                :title="`${formatTime(cue.start)} · ${cue.source}`" @click="store.selectCue(cue.id)"
              ><span>{{ actorName(cue.actorId).split('/')[0] }}</span><b>{{ cue.target || cue.source }}</b></button>
              <div class="timeline-ruler"><span v-for="tick in [0, 15, 30, 45, 60]" :key="tick" :style="{ left: `${(tick / store.totalDuration) * 100}%` }">{{ tick }}s</span></div>
            </div>
          </div>
        </div>

        <div class="cue-toolbar">
          <div class="section-heading"><span>{{ store.t('cues') }}</span><el-tag size="small" type="info">{{ filteredCues.length }}</el-tag></div>
          <el-input v-model="search" :prefix-icon="Search" clearable placeholder="搜索原文或译文" class="cue-search" />
          <el-select v-model="actorFilter" class="actor-mobile-filter">
            <el-option :label="store.t('allActors')" value="all" />
            <el-option v-for="actor in project.actors" :key="actor.id" :label="actor.name" :value="actor.id" />
          </el-select>
        </div>

        <div class="cue-list">
          <article
            v-for="(cue, index) in filteredCues" :key="cue.id" class="cue-row" :class="{ active: cue.id === selectedCueId, issue: cue.status === 'issue', locked: cue.locked }"
            tabindex="0" @click="store.selectCue(cue.id)" @keydown.enter="store.selectCue(cue.id)"
          >
            <div class="cue-number">{{ String(index + 1).padStart(2, '0') }}</div>
            <div class="cue-main">
              <div class="cue-topline">
                <span class="actor-pill" :style="{ '--actor': actorColor(cue.actorId) }">{{ actorName(cue.actorId) }}</span>
                <code>{{ formatTime(cue.start) }} → {{ formatTime(cue.end) }}</code>
                <el-tag size="small" :type="statusType(cue.status)">{{ statusLabel(cue.status) }}</el-tag>
                <el-icon v-if="cue.locked"><Lock /></el-icon>
                <span class="cue-warning-count" v-if="cueWarnings(cue).length">{{ cueWarnings(cue).length }} context</span>
              </div>
              <p class="source-text">{{ cue.source }}</p>
              <p class="target-text" :class="{ empty: !cue.target }">{{ cue.target || '尚未填写译文' }}</p>
            </div>
            <div class="cue-quick-actions">
              <el-button size="small" text :icon="MagicStick" @click.stop="store.splitCue(cue.id)">{{ store.t('split') }}</el-button>
              <el-button size="small" text :icon="Files" @click.stop="store.mergeNext(cue.id)">{{ store.t('merge') }}</el-button>
              <el-button size="small" text :icon="Delete" @click.stop="requestDelete(cue.id)" />
            </div>
          </article>
          <div v-if="!filteredCues.length" class="empty-state">{{ store.t('empty') }}</div>
        </div>
        </template>

        <section v-else class="duration-sheet">
          <div class="duration-toolbar">
            <div class="duration-summary">
              <el-icon><VideoPlay /></el-icon>
              <strong>{{ store.t('durationCheck') }}</strong>
              <el-tag v-if="store.staleCheckCount" size="small" type="warning">{{ store.t('dcStaleCount', { count: store.staleCheckCount }) }}</el-tag>
              <el-tag v-if="store.unresolvedOvertimeCount" size="small" type="danger">{{ store.t('dcOvertimeCount', { count: store.unresolvedOvertimeCount }) }}</el-tag>
              <el-tag v-if="!store.staleCheckCount && !store.unresolvedOvertimeCount && durationRows.length" size="small" type="success">{{ store.t('dcAllClear') }}</el-tag>
            </div>
            <el-button size="small" type="primary" plain @click="runAllChecks">{{ store.t('rerunAll') }}</el-button>
          </div>
          <p class="duration-hint">{{ store.t('durationHint') }}</p>

          <el-table :data="durationRows" size="small" class="duration-table" :row-class-name="durationRowClass" @row-click="onDurationRowClick">
            <el-table-column width="56" label="#">
              <template #default="{ $index }">{{ String($index + 1).padStart(2, '0') }}</template>
            </el-table-column>
            <el-table-column min-width="200" :label="store.t('target')">
              <template #default="{ row }">
                <span class="actor-pill" :style="{ '--actor': actorColor(row.cue.actorId) }">{{ actorName(row.cue.actorId) }}</span>
                <p class="dc-target" :class="{ empty: !row.cue.target }">{{ row.cue.target || store.t('dcEmptyTarget') }}</p>
              </template>
            </el-table-column>
            <el-table-column width="148" :label="store.t('timecode')">
              <template #default="{ row }">
                <code>{{ formatTime(row.cue.start) }}<br />→ {{ formatTime(row.cue.end) }}</code>
              </template>
            </el-table-column>
            <el-table-column width="84" :label="store.t('dcWindow')">
              <template #default="{ row }">{{ rowWindow(row).toFixed(1) }} {{ store.t('dcSeconds') }}</template>
            </el-table-column>
            <el-table-column width="128" :label="store.t('dcEstimated')">
              <template #default="{ row }">
                <b :class="{ over: row.live > rowWindow(row) }">{{ row.live ? `${row.live.toFixed(1)} ${store.t('dcSeconds')}` : '—' }}</b>
                <small>{{ store.t('dcRateHint', { rate: row.liveRate, unit: rateUnit, speed: row.cue.speed }) }}</small>
                <small v-if="row.check && !row.stale">{{ store.t('dcCheckedAt', { time: new Date(row.check.checkedAt).toLocaleTimeString() }) }}</small>
              </template>
            </el-table-column>
            <el-table-column width="118" :label="store.t('dcOvertime')">
              <template #default="{ row }">
                <template v-if="row.check && !row.stale">
                  <span v-if="row.check.overtime" class="dc-over">+{{ row.check.excess.toFixed(1) }} {{ store.t('dcSeconds') }}</span>
                  <span v-else class="dc-fit">0</span>
                </template>
                <span v-else class="dc-pending">{{ store.t('dcLiveEstimate') }}：{{ row.live ? `${row.live.toFixed(1)}` : '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column width="116" :label="store.t('dcStatus')">
              <template #default="{ row }">
                <el-tag size="small" :type="statusTag(row.check, row.stale).type">{{ statusTag(row.check, row.stale).text }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column min-width="210" :label="store.t('dcNote')">
              <template #default="{ row }">
                <el-input
                  :model-value="row.check?.note ?? ''" size="small" :placeholder="store.t('dcNotePlaceholder')"
                  :class="{ required: row.check?.overtime && !(row.check.note || '').trim() }"
                  :disabled="!row.check || row.stale"
                  @click.stop @change="onNoteInput(row.cue.id, $event)"
                />
              </template>
            </el-table-column>
            <el-table-column width="84" align="right">
              <template #default="{ row }">
                <el-button size="small" text @click.stop="runRowCheck(row.cue.id)">{{ store.t('rerunRow') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="!durationRows.length" class="empty-state">{{ store.t('empty') }}</div>
        </section>
      </section>

      <aside class="right-panel panel">
        <div class="section-heading">
          <span><el-icon><EditPen /></el-icon>{{ store.t('inspector') }}</span>
          <span v-if="selectedCue" class="cue-index">#{{ project.cues.findIndex((cue) => cue.id === selectedCue?.id) + 1 }}</span>
        </div>
        <div v-if="selectedCue" class="inspector">
          <template v-if="selectedCue.locked">
            <div class="locked-note"><el-icon><Lock /></el-icon>{{ store.t('locked') }}</div>
          </template>
          <label>{{ store.t('actor') }}</label>
          <el-select :model-value="selectedCue.actorId" :disabled="selectedCue.locked" @change="updateSelected({ actorId: String($event) }, 'actor')">
            <el-option v-for="actor in project.actors" :key="actor.id" :label="actor.name" :value="actor.id" />
          </el-select>
          <div class="two-columns">
            <div><label>{{ store.t('start') }}</label><el-input-number :model-value="selectedCue.start" :disabled="selectedCue.locked" :min="0" :step="0.1" controls-position="right" @change="updateSelected({ start: Number($event) }, 'start-time')" /></div>
            <div><label>{{ store.t('end') }}</label><el-input-number :model-value="selectedCue.end" :disabled="selectedCue.locked" :min="selectedCue.start + 0.1" :step="0.1" controls-position="right" @change="updateSelected({ end: Number($event) }, 'end-time')" /></div>
          </div>
          <label>{{ store.t('source') }}</label>
          <el-input :model-value="selectedCue.source" type="textarea" :rows="4" :disabled="selectedCue.locked" @change="updateSelected({ source: String($event) }, 'source-text')" />
          <label>{{ store.t('target') }}</label>
          <el-input :model-value="selectedCue.target" type="textarea" :rows="5" :disabled="selectedCue.locked" @change="updateSelected({ target: String($event) }, 'target-text')" />
          <div class="two-columns">
            <div><label>{{ store.t('speed') }}</label><el-input-number :model-value="selectedCue.speed" :disabled="selectedCue.locked" :min="0.5" :max="1.8" :step="0.01" controls-position="right" @change="updateSelected({ speed: Number($event) }, 'speed')" /></div>
            <div><label>{{ store.t('status') }}</label><el-select :model-value="selectedCue.status" :disabled="selectedCue.locked" @change="store.markStatus(selectedCue.id, $event)"><el-option :label="store.t('draft')" value="draft" /><el-option :label="store.t('reviewed')" value="reviewed" /><el-option :label="store.t('issue')" value="issue" /></el-select></div>
          </div>
          <label>{{ store.t('termsUsed') }}</label>
          <el-select :model-value="selectedCue.termIds" multiple :disabled="selectedCue.locked" @change="updateSelected({ termIds: $event }, 'terms')">
            <el-option v-for="term in project.terms" :key="term.id" :label="`${term.source} → ${term.target}`" :value="term.id" />
          </el-select>
          <div class="inspector-actions">
            <el-button :icon="selectedCue.locked ? Unlock : Lock" @click="store.toggleLock(selectedCue.id)">{{ selectedCue.locked ? store.t('unlock') : store.t('lock') }}</el-button>
            <el-button @click="store.moveCue(selectedCue.id, -1)">↑ {{ store.t('moveUp') }}</el-button>
            <el-button @click="store.moveCue(selectedCue.id, 1)">↓ {{ store.t('moveDown') }}</el-button>
          </div>

          <div class="check-card">
            <h3>{{ store.t('warnings') }}</h3>
            <p v-if="!selectedWarnings.length" class="check-ok">{{ store.t('noWarnings') }}</p>
            <p v-for="warning in selectedWarnings" :key="warning.type" class="check-warning">{{ warning.message }}</p>
            <p v-for="term in selectedTermMismatches" :key="term.id" class="check-warning">{{ store.t('termMismatch', { source: term.source, target: term.target }) }}</p>
            <p v-if="selectedCue.termIds.length && !selectedTermMismatches.length" class="check-ok">{{ store.t('noTermMismatch') }}</p>
          </div>
        </div>
        <div v-else class="empty-inspector">{{ store.t('selectHint') }}</div>
      </aside>
    </main>

    <footer class="shortcut-bar">
      <strong>{{ store.t('shortcuts') }}</strong>
      <span><kbd>J</kbd> {{ store.t('shortcutNext') }}</span>
      <span><kbd>K</kbd> {{ store.t('shortcutPrev') }}</span>
      <span><kbd>A</kbd> {{ store.t('shortcutReview') }}</span>
      <span><kbd>X</kbd> {{ store.t('shortcutIssue') }}</span>
      <span><kbd>L</kbd> {{ store.t('shortcutLock') }}</span>
      <span><kbd>Ctrl/⌘ Z</kbd> {{ store.t('shortcutUndo') }}</span>
    </footer>

    <el-dialog v-model="exportBlockDialog" :title="blockerSummary.stale ? store.t('dcExportStaleTitle') : store.t('dcExportOvertimeTitle')" width="460px">
      <div class="export-block-body">
        <p v-if="blockerSummary.stale">{{ store.t('dcExportStaleBody', { count: blockerSummary.stale }) }}</p>
        <p v-if="blockerSummary.unresolved">{{ store.t('dcExportOvertimeBody', { count: blockerSummary.unresolved }) }}</p>
      </div>
      <template #footer>
        <el-button v-if="blockerSummary.stale" type="primary" @click="goRecheck">{{ store.t('rerunAll') }}</el-button>
        <el-button @click="goDurationSheet">{{ store.t('dcReviewNow') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="snapshotDialog" :title="store.t('snapshot')" width="460px">
      <el-input v-model="snapshotName" :placeholder="store.t('newSnapshotName')" @keyup.enter="createSnapshot" />
      <div class="snapshot-list">
        <div v-for="snapshot in project.snapshots" :key="snapshot.id" class="snapshot-item">
          <div><b>{{ snapshot.name }}</b><small>{{ store.t('createdAt') }} {{ new Date(snapshot.createdAt).toLocaleString() }}</small></div>
          <span>{{ store.t('cueCount', { count: snapshot.cues.length }) }}</span>
          <el-button size="small" @click="store.restoreSnapshot(snapshot.id); snapshotDialog = false">{{ store.t('restore') }}</el-button>
        </div>
        <p v-if="!project.snapshots.length" class="empty-state">{{ store.t('noSnapshots') }}</p>
      </div>
      <template #footer><el-button type="primary" @click="createSnapshot">{{ store.t('snapshot') }}</el-button></template>
    </el-dialog>
  </div>
</template>
