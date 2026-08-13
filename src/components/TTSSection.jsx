import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2, Square, Eraser, Gauge, Mic2, AlertTriangle, Languages, Wand2, AudioLines, ChevronDown, Music2, ListOrdered, Download } from 'lucide-react'
import { validateText, detectLang, splitSentences, MAX_TEXT_CHARS } from '../utils/textUtils'
import { useWebSpeechTTS } from '../hooks/useWebSpeechTTS'
import { useToast } from './ToastContext'

/**
 * قسم تحويل النص إلى كلام (TTS) — Web Speech API الأصلي:
 * لا Worker ولا نماذج ولا تحميلات — المتصفح نفسه يقرأ النص بصوته المحلي.
 * خفيف جداً (صفر ميغابايت) ويعمل أوفلاين تماماً بعد أول فتح للموقع.
 */
export default function TTSSection() {
  const { t } = useTranslation()
  const toast = useToast()

  const [text, setText] = useState('')
  const [wasOver, setWasOver] = useState(false)

  const {
    voices,
    selectedVoice,
    setSelectedVoice,
    speak,
    speakSentence,
    stop,
    isPlaying,
    rate,
    setRate,
    pitch,
    setPitch,
    currentIndex,
    audioUrl,
    isRecording,
    recorderSupported,
    clearAudio,
  } = useWebSpeechTTS()

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  // ====== اشتقاقات ======
  const lang = useMemo(() => detectLang(text), [text])
  const charInfo = useMemo(() => validateText(text), [text])
  const detectedSentences = useMemo(() => splitSentences(text), [text])

  // اسم ملف التنزيل: speech-audio-YYYY-MM-DD.webm
  const downloadName = `speech-audio-${new Date().toISOString().slice(0, 10)}.webm`

  const handleTextChange = (e) => {
    const raw = e.target.value
    if (raw.length > MAX_TEXT_CHARS && !wasOver) {
      setWasOver(true)
      toast.warning(t('tts.tooLong', { max: MAX_TEXT_CHARS }), { duration: 4500 })
    } else if (raw.length <= MAX_TEXT_CHARS && wasOver) {
      setWasOver(false)
    }
    // مسح التنزيل السابق عند تعديل النص
    if (raw !== text) clearAudio()
    setText(raw.slice(0, MAX_TEXT_CHARS))
  }

  const handleSpeak = () => {
    const clean = text.trim()
    if (!clean) {
      toast.warning(t('tts.empty'))
      return
    }
    if (!charInfo.ok) {
      toast.warning(t('tts.tooLong', { max: MAX_TEXT_CHARS }))
      return
    }
    if (!supported) {
      toast.error(t('tts.unsupported'))
      return
    }
    speak(clean)
  }

  const handleStop = () => {
    stop()
  }

  // اسم الصوت المختار مختصراً للعرض
  const selectedLabel = voices.find((v) => v.name === selectedVoice)?.name || ''

  const inputBtnCls = `flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border border-slate-700/60 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 disabled:opacity-40`

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

        {/* حالة المحرك — Web Speech جاهز دائماً */}
        <div
          className={`mt-4 flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm font-semibold ${
            supported
              ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
              : 'text-rose-300 border-rose-500/30 bg-rose-500/10'
          }`}
        >
          {supported ? <AudioLines size={16} /> : <AlertTriangle size={16} />}
          <span className="flex-1">{supported ? t('tts.nativeReady') : t('tts.unsupported')}</span>
          {supported && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              {t('tts.nativeBadge')} ✓
            </span>
          )}
        </div>

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
              {voices.length} {t('tts.voicesCount')}
            </span>
          </div>

          {/* ===== اختيار الصوت ===== */}
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <Mic2 size={15} className="text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-slate-400 w-24 shrink-0">{t('tts.voiceLabel')}</span>
              <div className="relative flex-1 min-w-0">
                <select
                  value={selectedVoice || ''}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  disabled={isPlaying || !supported || voices.length === 0}
                  className="w-full appearance-none rounded-xl bg-slate-900/80 border border-slate-700/60 focus:border-cyan-400/60 outline-none px-3 py-2.5 pe-9 text-sm text-slate-200 cursor-pointer transition-colors disabled:opacity-40"
                >
                  {voices.length === 0 && <option value="">{t('tts.noVoices')}</option>}
                  {voices.map((v) => (
                    <option key={v.name} value={v.name} className="bg-slate-900">
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={15}
                  className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-3 text-slate-500"
                />
              </div>
            </div>
            {selectedLabel && (
              <p className="mt-2 text-[10px] text-slate-500 truncate" dir="ltr">
                {selectedLabel}
              </p>
            )}
          </div>

          {/* ===== السرعة ===== */}
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <Gauge size={15} className="text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-slate-400 w-24 shrink-0">{t('tts.speedLabel')}</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="flex-1 accent-cyan-400"
                disabled={!supported}
              />
              <span className="text-sm font-extrabold text-cyan-200 tabular-nums w-11 text-left shrink-0">
                {rate.toFixed(1)}×
              </span>
            </div>
          </div>

          {/* ===== النبرة ===== */}
          <div className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-950/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <Music2 size={15} className="text-cyan-300 shrink-0" />
              <span className="text-xs font-bold text-slate-400 w-24 shrink-0">{t('tts.pitchLabel')}</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={pitch}
                onChange={(e) => setPitch(Number(e.target.value))}
                className="flex-1 accent-cyan-400"
                disabled={!supported}
              />
              <span className="text-sm font-extrabold text-cyan-200 tabular-nums w-11 text-left shrink-0">
                {pitch.toFixed(1)}×
              </span>
            </div>
          </div>

          {/* ===== الأزرار ===== */}
          <div className="flex items-center justify-between gap-2 mt-4">
            <button
              onClick={() => {
                handleStop()
                setText('')
              }}
              disabled={!text && !isPlaying}
              className={inputBtnCls}
              title={t('tts.clear')}
            >
              <Eraser size={15} />
              {t('tts.clear')}
            </button>

            {isPlaying ? (
              <button
                onClick={handleStop}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-extrabold bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-lg shadow-rose-500/25 active:scale-95 transition-all"
              >
                <Square size={16} />
                {t('tts.stop')}
              </button>
            ) : (
              <button
                onClick={handleSpeak}
                disabled={!text.trim() || !charInfo.ok || !supported}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-extrabold bg-gradient-to-r from-cyan-500 to-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/45 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Wand2 size={16} />
                {t('tts.speak')}
              </button>
            )}
          </div>

          {/* ===== التنزيل وحالة التسجيل ===== */}
          {isRecording && (
            <p className="mt-3 flex items-center gap-2 text-xs text-rose-300 font-semibold">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
              </span>
              {t('tts.recordingBadge')}
            </p>
          )}

          {audioUrl && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
              <span className="text-xs font-semibold text-emerald-200 flex items-center gap-1.5">
                <AudioLines size={13} />
                {t('tts.audioReady')}
              </span>
              <a
                href={audioUrl}
                download={downloadName}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-500 text-slate-950 hover:bg-emerald-400 active:scale-95 transition-all"
              >
                <Download size={13} />
                {t('tts.downloadAudio')}
              </a>
            </div>
          )}

          {!recorderSupported && (
            <p className="mt-2 text-[10px] text-slate-600 flex items-center gap-1">
              <AlertTriangle size={10} />
              {t('tts.recordingUnsupported')}
            </p>
          )}

          {!supported && (
            <p className="mt-4 text-sm text-rose-400 flex items-center gap-2">
              <AlertTriangle size={14} />
              {t('tts.unsupported')}
            </p>
          )}

          {/* ===== قائمة الجمل المكتشفة مع التتبع ===== */}
          {detectedSentences.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] font-semibold text-slate-500 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                <ListOrdered size={12} />
                {t('tts.sentencesLabel')} · {detectedSentences.length}
              </p>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800/80 divide-y divide-slate-800/60">
                {detectedSentences.map((s, i) => {
                  const isCurrent = isPlaying && i === currentIndex
                  return (
                    <button
                      key={i}
                      onClick={() => speakSentence(i)}
                      disabled={!supported}
                      className={`w-full text-start flex gap-3 px-3 py-2 text-sm transition-colors ${
                        isCurrent
                          ? 'bg-cyan-500/15 border-r-2 border-cyan-400 text-cyan-100'
                          : 'hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <span className="shrink-0 text-[11px] text-cyan-300/80 font-mono pt-0.5 tabular-nums w-5 text-center">
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0">{s}</span>
                      {isCurrent && (
                        <AudioLines size={13} className="shrink-0 mt-1 text-cyan-300 animate-pulse" />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[10px] text-slate-600">{t('tts.sentencesHint')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
