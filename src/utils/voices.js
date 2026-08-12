// ====== تعريف الأصوات المتاحة وروابطها — مشترك بين الواجهة والـ Worker ======
// كل صوت: معرّف فريد + رابط HuggingFace الأساسي (يُضاف إليه .onnx / .onnx.json)
// + مفتاح الترجمة لاسمه في الواجهة.
import { PIPER_CACHE_NAME } from './modelCache.js'

export const VOICE_MANIFEST = {
  // عربي — رجل رسمي (rhasspy الرسمي)
  'ar_JO-kareem-medium': {
    labelKey: 'tts.voiceKareem',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium',
  },
  // عربي — شاب (صوت عربي بديل متوافق من المجتمع)
  'ar-x-kimbolingo': {
    labelKey: 'tts.voiceAmro',
    url: 'https://huggingface.co/kimbolingo/arabic-piper-tts/resolve/main/arabic_single_last',
  },
  // عربي — امرأة هادئة (لهجة إماراتية — صوت أنثى)
  'ar-x-emirati-female': {
    labelKey: 'tts.voiceZain',
    url: 'https://huggingface.co/vadimbelsky/arabic-emirati-female-piper/resolve/main/arabic-emirati-female-model',
  },
  // إنجليزي أمريكي (rhasspy الرسمي)
  'en_US-lessac-medium': {
    labelKey: 'tts.voiceLessac',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium',
  },
}

export const DEFAULT_VOICE = 'ar_JO-kareem-medium'

// الأصوات العربية (تُستخدم للنص العربي — الإنجليزي له صوت مستقل)
export const ARABIC_VOICES = new Set([
  'ar_JO-kareem-medium',
  'ar-x-kimbolingo',
  'ar-x-emirati-female',
])

/** هل معرّف الصوت معروف؟ */
export function isKnownVoice(voiceId) {
  return Boolean(voiceId && VOICE_MANIFEST[voiceId])
}

/** الرابط الأساسي لصوت (مع fallback للصوت الافتراضي) */
export function voiceBaseUrl(voiceId) {
  return (VOICE_MANIFEST[voiceId] || VOICE_MANIFEST[DEFAULT_VOICE]).url
}

/**
 * هل صوت معيّن مخزّن محلياً؟ يفحص بالرابط الكامل (base + .onnx) —
 * لأن أسماء ملفات الأصوات المجتمعية لا تطابق معرّفاتها.
 */
export async function isVoiceCachedById(voiceId) {
  try {
    if (typeof caches === 'undefined') return false
    const cache = await caches.open(PIPER_CACHE_NAME)
    return Boolean(await cache.match(voiceBaseUrl(voiceId) + '.onnx'))
  } catch {
    return false
  }
}
