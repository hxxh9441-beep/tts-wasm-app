// ===== Worker تحويل النص إلى كلام (TTS) — Piper عبر onnxruntime-web =====
// يعمل في خيط منفصل: يحمّل نموذج Piper ONNX (حسب الصوت المختار) ويولّد صوت WAV محلياً.
// يعمل بمحرك WASM دائماً (مستقر وأوفلاين بالكامل).
// أوزان الأصوات تُخزَّن في Cache API عند أول استخدام فقط (On-Demand Fetching) —
// لا يُنزَّل أي صوت عند فتح الموقع، بل الصوت المختار عند أول توليد به.
//
// ملاحظة البناء: piper-tts-web (≈44MB مع onnxruntime-web) يُستورد ديناميكياً من CDN
// وليس داخل الـ bundle — لأن Cloudflare Pages يرفض الملفات الأكبر من 25MB.
// يُحمَّل مرة واحدة عند أول استخدام ويُخزَّن في Cache API (مثل النماذج تماماً).
import { PIPER_CACHE_NAME } from '../utils/modelCache.js'
import { DEFAULT_VOICE, isKnownVoice, voiceBaseUrl, isVoiceCachedById } from '../utils/voices.js'

// رابط مكتبة piper-tts-web (نفس النسخة المثبتة) — يُحمَّل ديناميكياً عند أول تهيئة
// ويُخزَّن في Cache API عبر الاعتراض — يعمل دون إنترنت بعد أول استخدام
const PIPER_CDN_URL = 'https://cdn.jsdelivr.net/npm/piper-tts-web@1.1.2/dist/piper-tts-web.js'

/** جذر التطبيق — يدعم النشر في مسار فرعي (مثل GitHub Pages) */
function appRoot() {
  try {
    const href = self.location?.href || ''
    const idx = href.indexOf('/assets/')
    if (idx > -1) return href.slice(0, idx + 1)
    return new URL('.', href).href
  } catch {
    return '/'
  }
}
const ROOT = appRoot()

// مسارات ملفات WASM المحلية (يُنسخها vite من node_modules إلى public/)
const ONNX_BASE_PATH = `${ROOT}onnx/` // onnxruntime-web (piper)
const PHONEMIZE_BASE_PATH = `${ROOT}piper/` // piper_phonemize.wasm + .data

let piperModule = null
/** تحميل مكتبة piper-tts-web من CDN (مرة واحدة — يُخزَّن في الكاش عبر الاعتراض) */
async function loadPiper() {
  if (piperModule) return piperModule
  piperModule = await import(/* @vite-ignore */ PIPER_CDN_URL)
  return piperModule
}

// ===== اعتراض fetch: تخزين نماذج الأصوات + مكتبة TTS في Cache API عند أول تنزيل =====
const ORIGINAL_FETCH = self.fetch ? self.fetch.bind(self) : fetch

/** إعلام الواجهة بنسبة تنزيل النموذج (0-100) */
function postDownloadProgress(percent, file) {
  try {
    self.postMessage({ type: 'dl-progress', payload: { percent, file } })
  } catch {
    /* ignore */
  }
}

/** تنزيل استجابة مع تتبع النسبة المئوية (Content-Length + قراءة متدفقة) */
async function fetchWithProgress(input, init) {
  const resp = await ORIGINAL_FETCH(input, init)
  if (!resp || !resp.ok || !resp.body) return resp

  const total = Number(resp.headers.get('content-length')) || 0
  if (!total) return resp

  const reader = resp.body.getReader()
  const chunks = []
  let loaded = 0
  let lastEmit = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      const pct = Math.round((loaded / total) * 100)
      // لا نُرسل أكثر من 10 رسائل في الثانية — أداء أنعم
      if (pct - lastEmit >= 2 || pct >= 100) {
        lastEmit = pct
        postDownloadProgress(pct, String(input).split('/').pop())
      }
    }
  } catch (e) {
    reader.cancel().catch(() => {})
    throw e
  }

  const body = new Blob(chunks)
  return new Response(body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: resp.headers,
  })
}

// الأصول القابلة للتخزين المؤقت: نماذج الأصوات من HuggingFace + مكتبة TTS من CDN
const CACHEABLE_PREFIXES = [
  'https://huggingface.co/',
  'https://cdn.jsdelivr.net/',
  'https://unpkg.com/',
]

self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url
  if (url && CACHEABLE_PREFIXES.some((p) => url.startsWith(p))) {
    try {
      const cache = await caches.open(PIPER_CACHE_NAME)
      const cached = await cache.match(url)
      if (cached) return cached
      const resp = await fetchWithProgress(input, init)
      if (resp && resp.ok) {
        try {
          await cache.put(url, resp.clone())
        } catch {
          /* تجاوز سعة التخزين — نتجاهل بهدوء */
        }
      }
      return resp
    } catch {
      return ORIGINAL_FETCH(input, init)
    }
  }
  return ORIGINAL_FETCH(input, init)
}

// ===== خريطة الأصوات: معرّف الصوت ← الرابط الأساسي (يُضاف إليه .onnx / .onnx.json) =====
// معرّفة في src/utils/voices.js — مشتركة بين الواجهة والـ Worker

/**
 * مزوّد أصوات مخصص: يدعم أي repo على HuggingFace (رسمي أو مجتمعي).
 * يطابق واجهة FetchProvider في piper-tts-web:
 * fetch(voiceId) → [configObject (JSON محلل), blobUrl (عنوان الصوت)]
 * الـ fetch المعترض أعلاه يتكفل بالتخزين في Cache API عند أول استخدام.
 */
class CustomVoiceProvider {
  async fetch(voiceId) {
    const base = voiceBaseUrl(voiceId)
    const [jsonResp, onnxResp] = await Promise.all([
      fetch(base + '.onnx.json'),
      fetch(base + '.onnx'),
    ])
    const config = await jsonResp.json()
    const url = URL.createObjectURL(await onnxResp.blob())
    return [config, url]
  }
}

let engine = null
let voiceProvider = null
const device = 'wasm' // تطبيق TTS يعمل بمحرك WASM دائماً (مستقر وأوفلاين)
let currentVoice = null
let queue = [] // المهام المعلقة
let busy = false // هل نعالج مهمة الآن؟
let stopped = false

function post(type, payload, extra) {
  self.postMessage({ type, payload, ...(extra || {}) })
}

/**
 * تدشين المحرك — WASM دائماً (OnnxWebRuntime):
 * ملفات WASM (onnxruntime + phonemize) تُخدم محلياً عبر basePath صريح (أوفلاين).
 */
async function ensureEngine() {
  if (engine) return
  post('status', 'initializing')
  const { PiperWebEngine, OnnxWebRuntime, PhonemizeWebRuntime } = await loadPiper()
  voiceProvider = new CustomVoiceProvider()
  const runtimeOpts = { numThreads: 1, basePath: ONNX_BASE_PATH }
  const phonemizeRuntime = new PhonemizeWebRuntime({ basePath: PHONEMIZE_BASE_PATH })

  engine = new PiperWebEngine({
    onnxRuntime: new OnnxWebRuntime(runtimeOpts),
    phonemizeRuntime,
    voiceProvider,
  })
}

/** توليد الصوت لجملة واحدة — يُرجع WAV ArrayBuffer */
async function synthesize(text, voiceId) {
  const voice = isKnownVoice(voiceId) ? voiceId : DEFAULT_VOICE
  if (voice !== currentVoice) currentVoice = voice

  // إعلام الواجهة: هل الصوت محفوظ محلياً أم سيُنزَّل لأول مرة (On-Demand)؟
  const cached = await isVoiceCachedById(voice)
  post('status', cached ? 'cached-voice' : 'downloading', { device, voice })

  try {
    const response = await engine.generate(text, voice, 0)
    // response: { phonemeData, file: Blob('audio/x-wav'), duration: ms }
    const audio = await response.file.arrayBuffer()
    post('status', 'synthesizing', { device })
    return { audio, durationMs: response.duration }
  } catch (err) {
    throw new Error(String(err?.message || err))
  }
}

/** معالجة طابور المهام بالتسلسل (الجملة الأولى أولاً) */
async function processQueue() {
  if (busy) return
  busy = true
  while (queue.length && !stopped) {
    const task = queue.shift()
    try {
      const { audio, durationMs } = await synthesize(task.text, task.voice)
      if (!stopped) {
        post('result', { id: task.id, audio, durationMs, lang: task.lang, voice: currentVoice, device })
      }
    } catch (err) {
      if (!stopped) post('error', { id: task.id, message: String(err?.message || err) })
    }
  }
  busy = false
  if (!stopped) post('status', 'idle', { device })
}

self.onmessage = async (e) => {
  const { type, payload } = e.data || {}

  switch (type) {
    case 'LOAD': {
      stopped = false
      await ensureEngine()
      // لا يُنزَّل أي صوت هنا — التحميل يحدث عند أول توليد بالصوت المختار (On-Demand)
      currentVoice = isKnownVoice(payload?.voice) ? payload.voice : DEFAULT_VOICE
      post('status', 'ready', { device, voice: currentVoice })
      break
    }

    case 'SYNTHESIZE': {
      stopped = false
      queue.push({ ...payload })
      processQueue()
      break
    }

    case 'STOP': {
      stopped = true
      queue = []
      busy = false
      post('status', 'idle', { device })
      break
    }

    case 'UNLOAD': {
      stopped = true
      queue = []
      busy = false
      engine = null
      voiceProvider = null
      break
    }

    default:
      post('error', { message: 'Unknown message type: ' + type })
  }
}
