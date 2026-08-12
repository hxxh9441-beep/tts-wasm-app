// ===== نظام طابور التشغيل الصوتي (Audio Queue System) =====
// يستقبل شرائح النص، يرسل الجملة الأولى للتوليد فوراً ويشغّلها لحظة وصولها،
// بينما تُولَّد باقي الجمل في الخلفية عبر الـ Worker وتُشغَّل تباعاً.

const DELAY_BETWEEN_ENQUEUE = 40 // ms — فاصل زمني بين إرسال الجمل للـ Worker

export class AudioQueue {
  #worker = null
  #texts = []
  #lang = 'ar'
  #voice = null
  #speed = 1
  #currentIdx = -1
  #playing = false
  #epoch = 0 // عداد الجيل — لإبطال النتائج القديمة بعد stop/start
  #activeIds = new Set() // معرفات المهام النشطة في الـ Worker
  #pendingCount = 0 // عدد الجمل التي لم يُولَّد صوتها بعد
  #audioCache = new Map() // index -> { url, durationMs }
  #audioEl = null
  #cb = {}

  /**
   * @param {Worker} worker — مثيل ttsWorker
   * @param {object} callbacks
   *  onState(state, info) — 'loading' | 'ready' | 'generating' | 'playing' | 'waiting' | 'done' | 'error'
   *  onProgress({ current, total, generated })
   *  onSentenceStart(index, text)
   *  onSentenceEnd(index)
   *  onError(message)
   */
  constructor(worker, callbacks = {}) {
    this.#worker = worker
    this.#cb = callbacks
    this.#audioEl = new Audio()
    this.#audioEl.preload = 'auto'
    this.#audioEl.addEventListener('ended', () => this.#handleEnded())
    this.#audioEl.addEventListener('error', () => {
      this.#emit('onError', 'tts.playbackError')
    })

    if (worker) {
      worker.onmessage = (e) => this.#handleWorkerMessage(e)
    }
  }

  // ====== الواجهة العامة ======

  /** يبدأ توليد وتشغيل الشرائح */
  start(texts, { lang = 'ar', speed = 1, voice = null } = {}) {
    this.stop()
    this.#epoch += 1
    const epoch = this.#epoch

    this.#texts = texts.filter((t) => t && t.trim().length > 0)
    this.#lang = lang
    this.#voice = voice
    this.#speed = speed
    this.#currentIdx = -1
    this.#playing = false
    this.#pendingCount = this.#texts.length
    this.#activeIds.clear()
    this.#audioCache.clear()

    if (this.#texts.length === 0) {
      this.#emit('onError', 'tts.empty')
      return
    }

    this.#emit('onState', 'generating', { total: this.#texts.length })

    // إرسال كل الجمل للـ Worker — الأولى تبدأ فوراً والباقي يتسلسل في الخلفية
    this.#texts.forEach((text, i) => {
      const id = `${epoch}:${i}`
      this.#activeIds.add(id)
      this.#worker?.postMessage({
        type: 'SYNTHESIZE',
        payload: { id, text, lang, voice: this.#voice },
      })
    })
  }

  /** إيقاف التوليد والتشغيل فوراً */
  stop() {
    this.#epoch += 1
    this.#playing = false
    this.#activeIds.clear()
    this.#pendingCount = 0
    this.#audioCache.clear()
    try {
      this.#audioEl.pause()
      this.#audioEl.removeAttribute('src')
      this.#audioEl.load()
    } catch {
      /* ignore */
    }
    this.#worker?.postMessage({ type: 'STOP' })
  }

  /** ضبط سرعة التشغيل (0.5× – 2×) — تُطبَّق فوراً */
  setSpeed(speed) {
    this.#speed = speed
    try {
      this.#audioEl.playbackRate = speed
    } catch {
      /* ignore */
    }
  }

  /** تنظيف كامل عند إزالة المكوّن */
  destroy() {
    this.stop()
    this.#audioEl.remove()
    this.#worker = null
  }

  // ====== داخلي ======

  #emit(name, ...args) {
    try {
      this.#cb[name]?.(...args)
    } catch {
      /* ignore */
    }
  }

  #handleWorkerMessage(e) {
    const { type, payload } = e.data || {}
    switch (type) {
      case 'status':
        // تمرير حالة المحرك للمكوّن (التهيئة، التنزيل، الجهاز...)
        this.#emit('onWorkerStatus', payload, e.data?.device, e.data?.voice)
        if (payload === 'ready') this.#emit('onState', 'ready')
        else if (payload === 'downloading') this.#emit('onState', 'downloading')
        else if (payload === 'synthesizing') this.#emit('onState', 'generating')
        break

      case 'dl-progress':
        // نسبة تنزيل نموذج الصوت (أول استخدام فقط)
        this.#emit('onDownloadProgress', payload)
        break

      case 'result': {
        // تجاهل النتائج من جلسة سابقة
        if (!this.#activeIds.has(payload?.id)) return
        this.#activeIds.delete(payload.id)
        this.#pendingCount = Math.max(0, this.#pendingCount - 1)

        const [epochStr, indexStr] = String(payload.id).split(':')
        const index = Number(indexStr)
        if (index === 0) this.#epoch = Number(epochStr) // تثبيت الجيل الصحيح

        const url = URL.createObjectURL(new Blob([payload.audio], { type: 'audio/wav' }))
        this.#audioCache.set(index, { url, durationMs: payload.durationMs })

        this.#emit('onProgress', {
          current: this.#currentIdx + 1,
          total: this.#texts.length,
          generated: this.#texts.length - this.#pendingCount,
        })

        // شغّل فوراً إذا كانت الجملة التالية المنتظرة
        if (index === this.#currentIdx + 1 && !this.#playing) {
          this.#playNext()
        }
        break
      }

      case 'error': {
        if (this.#activeIds.has(payload?.id)) {
          this.#activeIds.delete(payload.id)
          this.#pendingCount = Math.max(0, this.#pendingCount - 1)
        }
        this.#emit('onError', payload?.message || 'tts.error')
        break
      }

      default:
        break
    }
  }

  #playNext() {
    const next = this.#currentIdx + 1
    const cached = this.#audioCache.get(next)
    if (!cached) {
      // الجملة التالية ما زالت تُولَّد — انتظر وصولها
      if (this.#pendingCount > 0) {
        this.#emit('onState', 'waiting', { index: next })
      }
      return
    }

    this.#currentIdx = next
    this.#playing = true
    this.#audioEl.src = cached.url
    this.#audioEl.playbackRate = this.#speed

    this.#emit('onState', 'playing', { index: next })
    this.#emit('onSentenceStart', next, this.#texts[next])

    this.#audioEl
      .play()
      .catch(() => {
        this.#playing = false
        this.#emit('onError', 'tts.playbackError')
      })
  }

  #handleEnded() {
    const endedIdx = this.#currentIdx
    this.#playing = false

    // تحرير ذاكرة الصوت المنتهي
    const prev = this.#audioCache.get(endedIdx)
    if (prev) {
      URL.revokeObjectURL(prev.url)
      this.#audioCache.delete(endedIdx)
    }

    this.#emit('onSentenceEnd', endedIdx)

    if (endedIdx >= this.#texts.length - 1) {
      // انتهت آخر جملة
      this.#emit('onState', 'done')
      this.#emit('onProgress', {
        current: this.#texts.length,
        total: this.#texts.length,
        generated: this.#texts.length,
      })
      return
    }

    this.#playNext()
  }
}

/** دالة مساعدة: تحويل Blob/ArrayBuffer إلى عنوان URL قابل للتشغيل */
export function blobToUrl(blob) {
  return URL.createObjectURL(blob)
}
