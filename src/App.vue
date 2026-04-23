<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import L from 'leaflet'

const DEFAULT_TK = '234c0bcb5eaa56c272991c9dbdb74d85'
const STORAGE_KEY = 'tianditu_map_points_v1'
const TK_STORAGE_KEY = 'tianditu_map_tk_v1'
const DEFAULT_CENTER = [33.9645, 118.2697]
const DEFAULT_ZOOM = 16

const mapEl = ref(null)
const points = ref(loadPoints())
const currentTk = ref(loadTiandituTk())
const showList = ref(false)

const showNameModal = ref(false)
const showManualModal = ref(false)
const showBatchModal = ref(false)
const showTkModal = ref(false)

const pointName = ref('')
const manualName = ref('')
const manualLat = ref('')
const manualLng = ref('')
const batchText = ref('')
const tkInput = ref(currentTk.value)

const pendingLatLng = ref(null)
const isAreaDrawing = ref(false)
const areaDraftVertices = ref([])
const finalizedAreaCoords = ref(null)

const inputBatchFile = ref(null)

let map = null
let vecLayer = null
let cvaLayer = null
let areaDraftLine = null
let areaPolygon = null
const markersById = new Map()
const pointRenderer = L.canvas({ padding: 0.2 })

const sortedPoints = computed(() => [...points.value].sort((a, b) => b.createdAt - a.createdAt))
const hasFinalArea = computed(() => Boolean(finalizedAreaCoords.value))

const mapHint = computed(() =>
  isAreaDrawing.value
    ? '区域绘制中：在地图上单击添加顶点，至少 3 个点后点击“完成区域”。'
    : '在地图上单击新增点位，或使用“输入坐标 / 批量添加”。',
)

const drawButtonText = computed(() => (isAreaDrawing.value ? '完成区域' : '绘制区域'))

onMounted(() => {
  initMap()
  syncMarkersFromPoints()
})

onBeforeUnmount(() => {
  if (map) {
    map.remove()
    map = null
  }
})

function initMap() {
  if (!mapEl.value) return
  map = L.map(mapEl.value, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM)

  refreshTiandituLayers()

  map.on('click', onMapClick)
}

function buildTiandituLayerUrl(layerName, tk) {
  return `http://t{s}.tianditu.gov.cn/${layerName}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layerName}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${tk}`
}

function refreshTiandituLayers() {
  if (!map) return
  if (vecLayer) map.removeLayer(vecLayer)
  if (cvaLayer) map.removeLayer(cvaLayer)

  vecLayer = L.tileLayer(buildTiandituLayerUrl('vec', currentTk.value), {
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    maxZoom: 18,
    minZoom: 1,
    attribution: '&copy; 天地图',
  }).addTo(map)

  cvaLayer = L.tileLayer(buildTiandituLayerUrl('cva', currentTk.value), {
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    maxZoom: 18,
    minZoom: 1,
    zIndex: 10,
    attribution: '',
  }).addTo(map)
}

function onMapClick(e) {
  if (isAreaDrawing.value) {
    appendAreaVertex(e.latlng)
    return
  }
  if (shouldIgnoreMapClickForNewPoint(e)) return

  pendingLatLng.value = { lat: e.latlng.lat, lng: e.latlng.lng }
  pointName.value = ''
  showNameModal.value = true
}

function shouldIgnoreMapClickForNewPoint(e) {
  const el = e.originalEvent?.target
  if (!el || !(el instanceof Element)) return false
  if (el.closest('.leaflet-control-container')) return true
  if (el.closest('.leaflet-popup')) return true
  return false
}

function loadPoints() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    return Array.isArray(data?.points) ? data.points : []
  } catch {
    return []
  }
}

function savePoints() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, points: points.value }))
  } catch (error) {
    console.error(error)
    alert('保存失败，可能是浏览器存储空间已满。')
  }
}

function loadTiandituTk() {
  try {
    const raw = localStorage.getItem(TK_STORAGE_KEY)
    const tk = String(raw ?? '').trim()
    return tk || DEFAULT_TK
  } catch {
    return DEFAULT_TK
  }
}

function saveTiandituTk(tk) {
  try {
    localStorage.setItem(TK_STORAGE_KEY, String(tk).trim() || DEFAULT_TK)
  } catch (error) {
    console.error(error)
    alert('TK 保存失败。')
  }
}

function addPointAndPersist(name, lat, lng, options = {}) {
  const p = {
    id: newId(),
    name,
    lat,
    lng,
    createdAt: Date.now(),
  }
  points.value.push(p)
  addMarkerForPoint(p)
  if (!options.skipSave) savePoints()
}

function addMarkerForPoint(p) {
  if (!map) return
  const marker = L.circleMarker([p.lat, p.lng], {
    renderer: pointRenderer,
    radius: 3.5,
    color: '#1d4ed8',
    weight: 1,
    fillColor: '#2563eb',
    fillOpacity: 0.95,
    bubblingMouseEvents: false,
  })
  marker.bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)
  marker.addTo(map)
  markersById.set(p.id, marker)
}

function syncMarkersFromPoints() {
  if (!map) return
  for (const marker of markersById.values()) map.removeLayer(marker)
  markersById.clear()
  for (const p of points.value) addMarkerForPoint(p)
}

function confirmNameModal() {
  const name = pointName.value.trim()
  if (!name) return alert('请输入点位名称。')
  if (!pendingLatLng.value) return
  addPointAndPersist(name, pendingLatLng.value.lat, pendingLatLng.value.lng)
  showNameModal.value = false
  pendingLatLng.value = null
}

function confirmManualModal() {
  const name = manualName.value.trim()
  const lat = parseDecimalInput(manualLat.value)
  const lng = parseDecimalInput(manualLng.value)
  if (!name) return alert('请输入点位名称。')
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return alert('纬度应在 -90 到 90。')
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return alert('经度应在 -180 到 180。')

  addPointAndPersist(name, lat, lng)
  showManualModal.value = false
  if (map) map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.55 })
}

function parseBatchPointText(rawText) {
  const items = []
  const errors = []
  const lines = String(rawText ?? '').split(/\r?\n/)
  let autoNameIndex = points.value.length + 1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    const lineNo = i + 1
    const cols = line.split(/[\t,，]/).map((s) => s.trim()).filter(Boolean)
    if (cols.length < 2) {
      errors.push(`第 ${lineNo} 行格式错误。`)
      continue
    }
    let name = ''
    let latRaw = ''
    let lngRaw = ''
    if (cols.length === 2) {
      ;[latRaw, lngRaw] = cols
    } else {
      name = cols.slice(0, cols.length - 2).join(' ')
      latRaw = cols[cols.length - 2]
      lngRaw = cols[cols.length - 1]
    }
    const lat = parseDecimalInput(latRaw)
    const lng = parseDecimalInput(lngRaw)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push(`第 ${lineNo} 行纬度无效。`)
      continue
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.push(`第 ${lineNo} 行经度无效。`)
      continue
    }
    if (!name) name = `批量点位 ${autoNameIndex}`
    autoNameIndex += 1
    items.push({ name, lat, lng })
  }
  return { items, errors }
}

function confirmBatchModal() {
  const { items, errors } = parseBatchPointText(batchText.value)
  if (errors.length > 0) {
    alert(`校验失败：\n${errors.slice(0, 3).join('\n')}`)
    return
  }
  if (items.length === 0) {
    alert('请输入批量数据。')
    return
  }

  for (const item of items) addPointAndPersist(item.name, item.lat, item.lng, { skipSave: true })
  savePoints()
  showBatchModal.value = false

  if (map) {
    const bounds = L.latLngBounds(items.map((item) => [item.lat, item.lng]))
    map.fitBounds(bounds.pad(0.2), { maxZoom: 17, animate: true })
  }
}

async function onBatchFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const raw = await file.text()
    const { items, errors } = parseBatchPointJson(raw)
    if (errors.length > 0) return alert(`JSON 校验失败：\n${errors.slice(0, 3).join('\n')}`)
    batchText.value = items.map((item) => `${item.name},${item.lat},${item.lng}`).join('\n')
  } catch (error) {
    console.error(error)
    alert('读取文件失败。')
  } finally {
    if (inputBatchFile.value) inputBatchFile.value.value = ''
  }
}

function parseBatchPointJson(rawText) {
  let data = null
  try {
    data = JSON.parse(rawText)
  } catch {
    return { items: [], errors: ['JSON 格式无效。'] }
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.points) ? data.points : null
  if (!list) return { items: [], errors: ['JSON 顶层应为数组或 points 数组。'] }

  const items = []
  const errors = []
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i]
    const rowNo = i + 1
    const lat = parseDecimalInput(row?.lat ?? row?.latitude ?? row?.y ?? row?.gis_y)
    const lng = parseDecimalInput(row?.lng ?? row?.longitude ?? row?.x ?? row?.gis_x)
    const name = String(row?.name ?? row?.title ?? `批量点位 ${rowNo}`).trim()
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      errors.push(`第 ${rowNo} 条纬度无效。`)
      continue
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.push(`第 ${rowNo} 条经度无效。`)
      continue
    }
    items.push({ name, lat, lng })
  }
  return { items, errors }
}

function parseDecimalInput(raw) {
  if (raw == null) return Number.NaN
  const s = String(raw).trim().replace(/，/g, ',').replace(/\s+/g, '')
  if (!s) return Number.NaN
  return Number(s)
}

function newId() {
  return crypto.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function focusPoint(id) {
  const marker = markersById.get(id)
  if (!marker || !map) return
  const ll = marker.getLatLng()
  map.flyTo(ll, Math.max(map.getZoom(), 14), { duration: 0.6 })
  marker.openPopup()
}

function deletePoint(id) {
  points.value = points.value.filter((p) => p.id !== id)
  const marker = markersById.get(id)
  if (marker && map) map.removeLayer(marker)
  markersById.delete(id)
  savePoints()
}

function clearAllPoints() {
  if (points.value.length === 0) return
  if (!window.confirm(`确定删除全部 ${points.value.length} 个点位吗？`)) return
  points.value = []
  for (const marker of markersById.values()) {
    if (map) map.removeLayer(marker)
  }
  markersById.clear()
  savePoints()
}

function exportPointsToFile() {
  if (points.value.length === 0) return alert('暂无点位可导出。')
  const payload = { version: 1, exportedAt: new Date().toISOString(), points: points.value }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `map-points-${new Date().toISOString().slice(0, 10)}.json`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function openTkModal() {
  tkInput.value = currentTk.value
  showTkModal.value = true
  nextTick(() => {})
}

function confirmTkModal() {
  const nextTk = tkInput.value.trim() || DEFAULT_TK
  currentTk.value = nextTk
  saveTiandituTk(nextTk)
  refreshTiandituLayers()
  showTkModal.value = false
}

function onDrawAreaClick() {
  if (isAreaDrawing.value) {
    finalizeAreaDrawing()
    return
  }
  startAreaDrawing()
}

function startAreaDrawing() {
  isAreaDrawing.value = true
  finalizedAreaCoords.value = null
  areaDraftVertices.value = []
  clearAreaPolygon()
  clearAreaDraftLine()
  if (map) map.doubleClickZoom.disable()
}

function finalizeAreaDrawing() {
  if (areaDraftVertices.value.length < 3) {
    alert('请至少绘制 3 个顶点。')
    return
  }
  finalizedAreaCoords.value = areaDraftVertices.value.map((ll) => [ll.lat, ll.lng])
  clearAreaDraftLine()
  clearAreaPolygon()
  if (map) {
    areaPolygon = L.polygon(areaDraftVertices.value, {
      color: '#115e59',
      weight: 3,
      fillColor: '#0f766e',
      fillOpacity: 0.3,
    }).addTo(map)
  }
  isAreaDrawing.value = false
  areaDraftVertices.value = []
  if (map) map.doubleClickZoom.enable()
}

function appendAreaVertex(latlng) {
  areaDraftVertices.value.push(latlng)
  redrawAreaDraftLine()
}

function redrawAreaDraftLine() {
  clearAreaDraftLine()
  if (!map || areaDraftVertices.value.length === 0) return
  areaDraftLine = L.polyline(areaDraftVertices.value, {
    color: '#115e59',
    weight: 4,
    opacity: 1,
    dashArray: '10 5',
  }).addTo(map)
}

function clearAreaDraftLine() {
  if (!map || !areaDraftLine) return
  map.removeLayer(areaDraftLine)
  areaDraftLine = null
}

function clearAreaPolygon() {
  if (!map || !areaPolygon) return
  map.removeLayer(areaPolygon)
  areaPolygon = null
}

function clearAreaState() {
  finalizedAreaCoords.value = null
  areaDraftVertices.value = []
  isAreaDrawing.value = false
  if (map) map.doubleClickZoom.enable()
  clearAreaDraftLine()
  clearAreaPolygon()
}

async function copyAreaCoordinates() {
  if (!finalizedAreaCoords.value) return alert('请先完成区域绘制。')
  const text = JSON.stringify(
    finalizedAreaCoords.value.map(([lat, lng]) => ({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    })),
    null,
    2,
  )
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    alert('区域经纬度已复制。')
  } catch (error) {
    console.error(error)
    alert('复制失败，请检查权限。')
  }
}

function escapeHtml(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}
</script>

<template>
  <div class="layout">
    <header class="toolbar">
      <h1 class="title">天地图打点</h1>
      <div class="toolbar-actions">
        <button type="button" class="btn secondary" @click="openTkModal">设置TK</button>
        <button type="button" class="btn secondary" @click="showManualModal = true">输入坐标</button>
        <button type="button" class="btn secondary" @click="showBatchModal = true">批量添加</button>
        <button type="button" class="btn secondary" :class="{ active: isAreaDrawing }" @click="onDrawAreaClick">
          {{ drawButtonText }}
        </button>
        <button type="button" class="btn secondary" :disabled="!hasFinalArea" @click="copyAreaCoordinates">
          复制区域经纬度
        </button>
        <button type="button" class="btn secondary" @click="clearAreaState">清空区域</button>
        <button type="button" class="btn secondary" :class="{ active: showList }" @click="showList = !showList">
          点位列表
        </button>
      </div>
    </header>

    <p class="hint">{{ mapHint }}</p>

    <div class="map-wrap">
      <div ref="mapEl" class="map"></div>

      <aside v-if="showList" class="panel">
        <div class="panel-head">
          <span>已保存点位（{{ sortedPoints.length }}）</span>
          <div class="panel-actions">
            <button type="button" class="link danger" @click="clearAllPoints">全部删除</button>
            <button type="button" class="link" @click="exportPointsToFile">导出</button>
            <button type="button" class="link" @click="showList = false">关闭</button>
          </div>
        </div>

        <p v-if="sortedPoints.length === 0" class="empty">暂无点位。</p>
        <ul v-else class="point-list">
          <li v-for="p in sortedPoints" :key="p.id" class="point-item" @click="focusPoint(p.id)">
            <div class="point-main">
              <strong>{{ p.name }}</strong>
              <span>{{ p.lat.toFixed(5) }}, {{ p.lng.toFixed(5) }}</span>
            </div>
            <button type="button" class="link danger" @click.stop="deletePoint(p.id)">删除</button>
          </li>
        </ul>
      </aside>
    </div>
  </div>

  <div v-if="showNameModal" class="modal-backdrop" @click.self="showNameModal = false">
    <div class="modal">
      <h2>输入点位名称</h2>
      <p class="muted">
        {{ pendingLatLng ? `${pendingLatLng.lat.toFixed(6)}, ${pendingLatLng.lng.toFixed(6)}` : '' }}
      </p>
      <input v-model.trim="pointName" type="text" maxlength="80" placeholder="例如：观测站A" @keydown.enter.prevent="confirmNameModal" />
      <div class="actions">
        <button class="btn secondary" @click="showNameModal = false">取消</button>
        <button class="btn" @click="confirmNameModal">保存</button>
      </div>
    </div>
  </div>

  <div v-if="showManualModal" class="modal-backdrop" @click.self="showManualModal = false">
    <div class="modal">
      <h2>输入坐标添加点位</h2>
      <input v-model.trim="manualName" type="text" maxlength="80" placeholder="点位名称" />
      <div class="row">
        <input v-model="manualLat" type="text" placeholder="纬度 33.9645" />
        <input v-model="manualLng" type="text" placeholder="经度 118.2697" />
      </div>
      <div class="actions">
        <button class="btn secondary" @click="showManualModal = false">取消</button>
        <button class="btn" @click="confirmManualModal">保存并定位</button>
      </div>
    </div>
  </div>

  <div v-if="showBatchModal" class="modal-backdrop" @click.self="showBatchModal = false">
    <div class="modal wide">
      <h2>批量添加点位</h2>
      <p class="muted">每行格式：名称,纬度,经度 或 纬度,经度。也可上传 JSON。</p>
      <div class="actions left">
        <button class="btn secondary" @click="inputBatchFile?.click()">上传JSON</button>
        <input ref="inputBatchFile" type="file" accept=".json,application/json" hidden @change="onBatchFileChange" />
      </div>
      <textarea v-model="batchText" rows="8" placeholder="示例：&#10;观测站A,33.9645,118.2697&#10;33.9651,118.2712"></textarea>
      <div class="actions">
        <button class="btn secondary" @click="showBatchModal = false">取消</button>
        <button class="btn" @click="confirmBatchModal">批量保存</button>
      </div>
    </div>
  </div>

  <div v-if="showTkModal" class="modal-backdrop" @click.self="showTkModal = false">
    <div class="modal">
      <h2>设置天地图TK</h2>
      <input v-model.trim="tkInput" type="text" placeholder="输入 tk，留空恢复默认" />
      <div class="actions">
        <button class="btn secondary" @click="showTkModal = false">取消</button>
        <button class="btn" @click="confirmTkModal">保存并刷新</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  margin: 0;
  height: 100%;
}

.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f8fafc;
  color: #0f172a;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
}

.title {
  margin: 0;
  font-size: 18px;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #fff;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.btn.secondary {
  border-color: #cbd5e1;
  background: #fff;
  color: #0f172a;
}

.btn.active {
  border-color: #0f766e;
  color: #0f766e;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  margin: 8px 16px;
  color: #475569;
  font-size: 14px;
}

.map-wrap {
  position: relative;
  flex: 1;
  min-height: 400px;
}

.map {
  height: 100%;
}

.panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  width: min(360px, 90vw);
  max-height: calc(100% - 24px);
  overflow: auto;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.15);
}

.panel-head {
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  border-bottom: 1px solid #e2e8f0;
}

.panel-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.point-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.point-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
}

.point-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.point-main strong,
.point-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.point-main span {
  font-size: 12px;
  color: #64748b;
}

.link {
  border: none;
  background: transparent;
  color: #2563eb;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.link.danger {
  color: #dc2626;
}

.empty {
  margin: 0;
  padding: 14px 12px;
  color: #64748b;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: grid;
  place-items: center;
  padding: 12px;
  z-index: 1200;
}

.modal {
  width: min(520px, 94vw);
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal.wide {
  width: min(680px, 94vw);
}

.modal h2 {
  margin: 0;
  font-size: 18px;
}

.modal input,
.modal textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}

.muted {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.actions.left {
  justify-content: flex-start;
}
</style>
