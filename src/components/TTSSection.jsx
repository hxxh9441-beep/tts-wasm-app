import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Volume2, Square, Eraser, Loader2, Wand2, Languages, Gauge,
  ListOrdered, AlertTriangle, Sparkles, CheckCircle2, AudioLines, Mic2, ChevronDown,
} from 'lucide-react'
import {
  validateText, splitSentences, detectLang, MAX_TEXT_CHARS,
} from '../utils/textUtils'
import { AudioQueue } from '../utils/audioQueue'
import { isVoiceCachedById } from '../utils/voices'
import ProgressBar from './ProgressBar'
import { useToast } from './ToastContext'

// ===== خيارات النبرات الصوتية =====
// 'auto' → اختيار تلقائي حسب لغة النص (العربي = كريم، الإنجليزي = ليساك)
const VOICE_OPTIONS = [
  { id: 'auto', labelKey: 'tts.voiceAuto' },
  { id: 'ar_JO-kareem-medium', labelKey: 'tts.voiceKareem' },
  { id: 'ar-x-kimbolingo', labelKey: 'tts.voiceAmro' },
  { id: 'ar-x-emirati-female', labelKey: 'tts.voiceZain' },
  { id: 'en_US-lessac-medium', labelKey: 'tts.voiceLessac' },
]

// الأصوات العربية (تُستخدم للنص العربي فقط — الإنجليزي له صوت مستقل)
const ARABIC_VOICES = new Set(['ar_JO-kareem-medium', 'ar-x-kimbolingo', 'ar-x-emirati-female'])

/**
 * يحسم الصوت النهائي من اختيار المستخدم ولغة النص:
 * - 'auto' → حسب لغة النص
 * - صوت عربي مع نص إنجليزي → العودة تلقائياً للصوت الإنجليزي (لا نطق عربياً للإنجليزي)
 * - خلاف ذلك → الصوت المختار
 */
function resolveVoice(selected, lang) {
  if (!selected || selected === 'auto') {
    return lang === 'ar' ? 'ar_JO-kareem-medium' : 'en_US-lessac-medium'
  }
  if (lang === 'en' && selected !== 'en_US-lessac-medium' && ARABIC_VOICES.has(selected)) {
    return 'en_US-lessac-medium'
  }
  return selected
}

/**
 * قسم تحويل النص إلى كلام (TTS) — Piper محلي (WASM):
 * محرر نصي + عداد أحرف (0/2000) + شريط سرعة + طابور تشغيل ذكي:
 * الجملة الأولى تُولَّد وتُشغَّل فوراً والباقي في الخلفية.
 */
export default function TTSSection() {
  const { t } = useTranslation()
  const tRef = useRef(t)
  tRef.current = t
  const toast = useToast()

  // ====== الحالة ======
  const [text, setText] = useState('')
  const [speed, setSpeed] = useState(1)
  // آخر نبرة مختارة تُحفظ محلياً (auto = حسب لغة النص)
  const [selectedVoice, setSelectedVoice] = useState(() => {
    try {
      return localStorage.getItem('voice-selected') || 'auto'
    } catch {
      return 'auto'
    }
  })
  const [engineStatus, setEngineStatus] = useState('loading') // loading | ready | error
  const [engineMsg, setEngineMsg] = useState('')
  const [engineNotice, setEngineNotice] = useState('')
  const [dlProgress, setDlProgress] = useState(null) // { percent, file } — أول تنزيل فقط
  const [queueState, setQueueState] = useState('idle') // idle | downloading | generating | playing | waiting | done
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [progress, setProgress] = useState({ current: 0, total: 0, generated: 0 })
  const [sentences, setSentences] = useState([])
  const [error, setError] = useState('')

  // ====== مراجع ======
  const workerRef = useRef(null)
  const queueRef = useRef(null)
  const wasOverRef = useRef(false) // تذكُّر تجاوز الحد — لإشعار واحد فقط

  // ====== اشتقاقات ======
  const lang = useMemo(() => detectLang(text), [text])
  const charInfo = useMemo(() => validateText(text), [text])
  const detectedSentences = useMemo(() => splitSentences(text), [text])

  // إشعار Toast عند محاولة تجاوز حد الـ 2000 حرف (مرة واحدة لكل محاولة)
  const handleTextChange = (e) => {
    const raw = e.target.value
    if (raw.length > MAX_TEXT_CHARS && !wasOverRef.current) {
      wasOverRef.current = true
      toast.warning(t('tts.tooLong', { max: MAX_TEXT_CHARS }), { duration: 4500 })
    } else if (raw.length <= MAX_TEXT_CHARS && wasOverRef.current) {
      wasOverRef.current = false
    }
    setText(raw.slice(0, MAX_TEXT_CHARS))
  }

  const active =
    queueState === 'downloading' ||
    queueState === 'generating' ||
    queueState === 'playing' ||
    queueState === 'waiting'

  // ====== تدشين الـ Worker والطابور ======
  useEffect(() => {
    let cancelled = false
    try {
      const worker = new Worker(new URL('../workers/ttsWorker.js', import.meta.url), {
        type: 'module',
      })
      workerRef.current = worker
      // كشف أخطاء الـ worker غير الملتقطة (خطأ في التهيئة/البناء)
      worker.onerror = (ev) => {
        if (cancelled) return
        console.error('[ttsWorker] uncaught error:', ev.message, ev.filename, ev.lineno)
        setEngineStatus('error')
        setEngineMsg(t('tts.engineError'))
      }

      const queue = new AudioQueue(worker, {
        onWorkerStatus: (status, device) => {
          if (cancelled) return
          const tr = tRef.current
          if (status === 'initializing') {
            setEngineStatus('loading')
            setEngineMsg(tr('tts.engineLoading'))
          } else if (status === 'downloading') {
            setEngineStatus('loading')
            setEngineMsg(tr('tts.engineDownloading'))
          } else if (status === 'cached-voice') {
            setEngineStatus('loading')
            setEngineMsg(tr('tts.cachedVoice'))
          } else if (status === 'ready') {
            setEngineStatus('ready')
            setEngineMsg(tr('tts.engineReady'))
          } else if (status === 'synthesizing') {
            setEngineMsg(tr('tts.generating'))
          } else if (status === 'idle') {
            setEngineStatus((s) => (s === 'error' ? s : 'ready'))
            setEngineMsg(tr('tts.engineReady'))
          }
          // تطبيق TTS يعمل محلياً بالكامل (WASM) — لا إشعارات وضع مطلوبة
        },
        onState: (state) => {
          if (cancelled) return
          setQueueState(state)
          if (state === 'done') {
            setCurrentIdx(-1)
            setDlProgress(null)
            toast.success(tRef.current('tts.stateDone'))
          } else if (state === 'idle') {
            setDlProgress(null)
          }
        },
        onProgress: (p) => setProgress(p),
        onDownloadProgress: (d) => {
          if (cancelled) return
          setDlProgress(d)
        },
        onSentenceStart: (idx) => {
          if (!cancelled) setCurrentIdx(idx)
        },
        onError: (msg) => {
          if (cancelled) return
          const tr = tRef.current
          const message = tr(msg) === msg ? msg : tr(msg)
          setError(message)
          setQueueState('idle')
          setDlProgress(null)
          toast.error(message)
        },
      })
      queueRef.current = queue

      worker.postMessage({
        type: 'LOAD',
        payload: {
          lang: detectLang(text) || 'en',
          voice: resolveVoice(selectedVoice, detectLang(text) || 'en'),
        },
      })
    } catch {
      setEngineStatus('error')
      setEngineMsg(t('tts.engineError'))
    }

    return () => {
      cancelled = true
      queueRef.current?.destroy()
      queueRef.current = null
      workerRef.current?.postMessage?.({ type: 'UNLOAD' })
      workerRef.current?.terminate?.()
      workerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ====== توليد وتشغيل ======
  const handleGenerate = useCallback(() => {
    setError('')
    const clean = text.trim()
    if (!clean) {
      setError(t('tts.empty'))
      return
    }
    if (!charInfo.ok) {
      setError(t('tts.tooLong', { max: MAX_TEXT_CHARS }))
      return
    }
    const sents = splitSentences(clean)
    setSentences(sents)
    setCurrentIdx(-1)
    setDlProgress(null)
    setProgress({ current: 0, total: sents.length, generated: 0 })
    const voice = resolveVoice(selectedVoice, detectLang(clean))
    queueRef.current?.start(sents, { lang: detectLang(clean), speed, voice })
  }, [text, speed, selectedVoice, charInfo.ok, t])

  // ====== إيقاف ======
  const handleStop = useCallback(() => {
    queueRef.current?.stop()
    setQueueState('idle')
    setCurrentIdx(-1)
    setError('')
  }, [])

  // ====== تغيير السرعة ======
  const handleSpeed = (v) => {
    const val = Number(v)
    setSpeed(val)
    queueRef.current?.setSpeed(val)
  }

  // ====== تغيير نبرة الصوت ======
  const handleVoiceChange = async (v) => {
    setSelectedVoice(v)
    try {
      localStorage.setItem('voice-selected', v)
    } catch {
      /* ignore */
    }
    if (v === 'auto' || v === 'en_US-lessac-medium') return
    // فحص الكاش: هل هذا الصوت محفوظ محلياً (On-Demand Fetching)؟
    try {
      const cached = await isVoiceCachedById(v)
      toast.info(cached ? t('tts.voiceCached') : t('tts.voiceWillDownload'), { duration: 4000 })
    } catch {
      /* ignore */
    }
  }

  // ====== تنظيف عند الإزالة ======
  useEffect(() => () => handleStop(), [handleStop])

  // ====== حالة المحرك ======
  const engineColor =
    engineStatus === 'ready' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : engineStatus === 'error' ? 'text-rose-300 border-rose-500/30 bg-rose-500/10'
        : 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10'

  const inputBtnCls = `flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border border-slate-700/60 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 disabled:opacity-40`

  const donePct = sentences.length > 0 ? Math.min(100, Math.round(((currentIdx + 1) / sentences.length) * 100)) : 0

  // الصوت الفعلي النشط (بعد الحسم مع لغة النص) — للشارة
  const activeVoiceId = resolveVoice(selectedVoice, lang)
  const activeVoiceShort = activeVoiceId.replace('-medium', '').replace('ar-x-', '')

  return (
    <section id="tts-section" className="scroll-mt-24 px-5 py-14">
      <div className="max-w-2xl mx-auto">
        {/* العنوان */}
        <div className="flex items-center gap-3 mb-2">
          <span className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
            <Volume2 size={19} className="text-cyan-300" />
          </span>
          <div>
            <h2 className="text-2xl font-extrabold">{t('tts.title')}</h2>
            <p className="text-sm text-slate-400">{t('tts.subtitle')}</p>
          </div>
        </div>

        {/* حالة المحرك */}
        <div className={`mt-4 flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm font-semibold ${engineColor}`}>
          {engineStatus === 'loading' && <Loader2 size={16} className="animate-spin" />}
          {engineStatus === 'ready' && <Sparkles size={16} />}
          {engineStatus === 'error' && <AlertTriangle size={16} />}
          <span className="flex-1">{engineMsg}</span>
          {engineStatus === 'ready' && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              {t('engine.label')} ✓
            </span>
          )}
        </div>
        {engineNotice && (
          <p className="mt-2 text-[11px] text-amber-300/80 flex items-center gap-1.5">
            <AlertTriangle size={11} />
            {engineNotice}
          </p>
        )}

        <div className="glass rounded-3xl p-5 sm:p-6 mt-4">
          {/* ===== المحرر النصي ===== */}
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder={t('tts.placeholder')}
            rows={6}
            className="w-full resize-none rounded-2xl bg-slate-950/60 border border-slate-700/60 focus:border-cyan-400/60 outline-none p-4 text-slate-200 placeholder:text-slate-600 text-[15px] leading-relaxed transition-colors"
          />

          {/* ===== شريط العداد + اللغة ===== */}
          <div className="flex items-center justify-between mt-3 px-1">
            <span
              className={`text-xs font-bold tabular-nums transition-colors ${
                charInfo.ok ? 'text-slate-500' : 'text-rose-400'
              }`}
            >
              {t('tts.charCount', { count: charInfo.length, max: MAX_TEXT_CHARS })}
              {!charInfo.ok && ` · ${t('tts.tooLong', { max: MAX_TEXT_CHARS })}`}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border border-slate-700/50 bg-slate-800/40 text-slate-300">
              <Languages size={12} className={lang === 'ar' ? 'text-cyan-300' : 'text-indigo-300'} />
              {lang === 'ar' ? t('tts.langAr') : t('tts.langEn')}
              <span className="text-slate-600">·</span>
              {activeVoiceShort}
            </span>
          </div>

          {/* ===== اختيار نبرة الصوت ===== */}
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <Mic2 size={15} className="text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-slate-400 w-24 shrink-0">{t('tts.voiceLabel')}</span>
              <div className="relative flex-1 min-w-0">
                <select
                  value={selectedVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  disabled={active}
                  className="w-full appearance-none rounded-xl bg-slate-900/80 border border-slate-700/60 focus:border-cyan-400/60 outline-none px-3 py-2.5 pe-9 text-sm text-slate-200 cursor-pointer transition-colors disabled:opacity-40"
                >
                  {VOICE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id} className="bg-slate-900">
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={15}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-3 text-slate-500"
                />
              </div>
            </div>
          </div>

          {/* ===== شريط التحكم بالسرعة ===== */}
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <Gauge size={15} className="text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-slate-400 w-24 shrink-0">{t('tts.speedLabel')}</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={speed}
                onChange={(e) => handleSpeed(e.target.value)}
                className="flex-1 accent-cyan-400"
                disabled={active}
              />
              <span className="text-sm font-extrabold text-cyan-200 tabular-nums w-11 text-left shrink-0">
                {speed.toFixed(1)}×
              </span>
            </div>
          </div>

          {/* ===== حالة التشغيل والتقدم ===== */}
          {active && (
            <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-cyan-100 font-semibold">
                {queueState === 'playing' ? (
                  <>
                    <AudioLines size={15} className="animate-pulse" />
                    {t('tts.statePlaying', { current: currentIdx + 1, total: sentences.length })}
                  </>
                ) : queueState === 'waiting' ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t('tts.stateWaiting')}
                  </>
                ) : queueState === 'downloading' ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {engineMsg}
                  </>
                ) : (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t('tts.stateGenerating', { index: Math.min(progress.generated + 1, progress.total), total: progress.total })}
                  </>
                )}
              </div>

              {/* مؤشر نسبة تجهيز المحرك (أول استخدام فقط) */}
              {queueState === 'downloading' && dlProgress?.percent != null && (
                <div className="mt-3">
                  <ProgressBar
                    percent={dlProgress.percent}
                    label={t('tts.engineDownloading')}
                    sublabel={dlProgress.file}
                    color="cyan"
                    size="sm"
                  />
                </div>
              )}

              <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-all duration-300"
                  style={{ width: `${donePct}%` }}
                />
              </div>
            </div>
          )}

          {queueState === 'done' && (
            <p className="mt-4 flex items-center gap-2 text-sm text-emerald-300 font-semibold">
              <CheckCircle2 size={16} />
              {t('tts.stateDone')}
            </p>
          )}

          {error && (
            <p className="mt-4 text-sm text-rose-400 flex items-center gap-2">
              <AlertTriangle size={14} />
              {error}
            </p>
          )}

          {/* ===== الأزرار ===== */}
          <div className="flex items-center justify-between gap-2 mt-4">
            <button
              onClick={() => {
                handleStop()
                setText('')
                setSentences([])
              }}
              disabled={!text && !active}
              className={inputBtnCls}
              title={t('tts.clear')}
            >
              <Eraser size={15} />
              {t('tts.clear')}
            </button>

            {active ? (
              <button
                onClick={handleStop}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-extrabold bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-lg shadow-rose-500/25 active:scale-95 transition-all"
              >
                <Square size={16} />
                {t('tts.stop')}
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={!text.trim() || !charInfo.ok || engineStatus === 'loading'}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-extrabold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/45 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Wand2 size={16} />
                {t('tts.speak')}
              </button>
            )}
          </div>

          {/* ===== قائمة الجمل المكتشفة ===== */}
          {detectedSentences.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                <ListOrdered size={12} />
                {t('tts.sentencesLabel')} · {detectedSentences.length}
              </p>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800/80 divide-y divide-slate-800/60">
                {detectedSentences.map((s, i) => {
                  const isCurrent = sentences.length > 0 && i === currentIdx
                  const isDone = sentences.length > 0 && i < currentIdx
                  return (
                    <div
                      key={i}
                      className={`flex gap-3 px-3 py-2 text-sm transition-colors ${
                        isCurrent
                          ? 'bg-cyan-500/10 border-r-2 border-cyan-400'
                          : isDone
                            ? 'opacity-50'
                            : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="shrink-0 text-[11px] text-cyan-300/80 font-mono pt-0.5 tabular-nums w-5 text-center">
                        {i + 1}
                      </span>
                      <span className={`leading-snug ${isCurrent ? 'text-cyan-100 font-semibold' : 'text-slate-300'}`}>
                        {s}
                      </span>
                      {isCurrent && <AudioLines size={14} className="shrink-0 text-cyan-300 self-center animate-pulse" />}
                      {isDone && <CheckCircle2 size={14} className="shrink-0 text-emerald-400 self-center" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
