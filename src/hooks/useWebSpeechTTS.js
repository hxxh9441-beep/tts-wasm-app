import { useState, useEffect, useRef, useCallback } from 'react';
import { splitSentences } from '../utils/textUtils';

/**
 * هوك تحويل النص إلى كلام عبر Web Speech API — مع تقسيم وتتبع الجمل + التقاط الصوت:
 * - يقسم النص إلى جمل ويقرأها بالتتابع (Queue)
 * - يلتقط الصوت الصادر عبر MediaRecorder + getDisplayMedia (صوت النظام)
 *   ملاحظة: Web Speech لا يمكن تسجيله مباشرة (قيد أمني) — التقاط صوت النظام
 *   يعمل على Chrome/Edge للحاسوب مع إذن المستخدم، وغير مدعوم على الجوال.
 * - يوفر audioUrl للتنزيل عند اكتمال القراءة.
 */
export const useWebSpeechTTS = () => {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [sentences, setSentences] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  // ====== حالة التسجيل ======
  const [audioUrl, setAudioUrl] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recorderSupported, setRecorderSupported] = useState(false);

  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null);
  // مراجع محدّثة — تمنع مشاكل closure وتعيد تعيين اختيار المستخدم
  const selectedVoiceRef = useRef(selectedVoice);
  selectedVoiceRef.current = selectedVoice;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const pitchRef = useRef(pitch);
  pitchRef.current = pitch;
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;

  // طابور القراءة + حالة التسجيل
  const queueRef = useRef([]);
  const singleRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const captureStreamRef = useRef(null);

  // فحص دعم التقاط صوت النظام (Chrome/Edge للحاسوب فقط)
  useEffect(() => {
    setRecorderSupported(
      typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices?.getDisplayMedia &&
        typeof MediaRecorder !== 'undefined'
    );
  }, []);

  useEffect(() => {
    const updateVoices = () => {
      if (!synthRef.current) return;
      const availableVoices = synthRef.current.getVoices();
      const arabicVoices = availableVoices.filter(v => v.lang.startsWith('ar'));
      const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));
      const combined = [...arabicVoices, ...englishVoices];

      setVoices(combined);

      // اختيار افتراضي فقط إن لم يختر المستخدم بعد
      if (arabicVoices.length > 0 && !selectedVoiceRef.current) {
        setSelectedVoice(arabicVoices[0].name);
      } else if (combined.length > 0 && !selectedVoiceRef.current) {
        setSelectedVoice(combined[0].name);
      }
    };

    updateVoices();
    if (synthRef.current) {
      synthRef.current.onvoiceschanged = updateVoices;
    }
    return () => {
      if (synthRef.current) {
        synthRef.current.onvoiceschanged = null;
        synthRef.current.cancel();
      }
    };
  }, []);

  /**
   * يبدأ التقاط صوت النظام (يطلب من المستخدم اختيار النافذة/الشاشة).
   * يُرجع true إذا نجح التسجيل، وإلا false (رفض/عدم دعم) — والقراءة تستمر دائماً.
   */
  const startRecording = useCallback(async () => {
    if (!recorderSupported) return false;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true, // مطلوب لبدء الالتقاط — نأخذ الصوت فقط
        selfBrowserSurface: 'include',
      });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach(t => t.stop());
        return false;
      }

      // نمرر الصوت فقط لمسجل الصوت
      const audioStream = new MediaStream(audioTracks);
      captureStreamRef.current = stream;
      recordingChunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordingChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setIsRecording(false);
        // إيقاف مسارات الالتقاط بعد الانتهاء
        if (captureStreamRef.current) {
          captureStreamRef.current.getTracks().forEach(t => t.stop());
          captureStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      return true;
    } catch {
      // رفض الإذن أو خطأ — نكمل القراءة بدون تسجيل
      return false;
    }
  }, [recorderSupported]);

  /** إنهاء التسجيل وإنتاج ملف الصوت */
  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else {
      setIsRecording(false);
      if (captureStreamRef.current) {
        captureStreamRef.current.getTracks().forEach(t => t.stop());
        captureStreamRef.current = null;
      }
      mediaRecorderRef.current = null;
    }
  }, []);

  /** تشغيل الجملة التالية في الطابور — تُستدعى من onend للانتقال التلقائي */
  const playNext = useCallback(() => {
    const sents = sentencesRef.current;
    const queue = queueRef.current;

    if (!queue.length) {
      setIsPlaying(false);
      setCurrentIndex(-1);
      // اكتملت القراءة — إنهاء التسجيل وإنتاج الملف
      if (mediaRecorderRef.current) stopRecording();
      return;
    }

    const idx = queue.shift();
    setCurrentIndex(idx);

    const utterance = new SpeechSynthesisUtterance(sents[idx]);
    const voiceObj = voicesRef.current.find(v => v.name === selectedVoiceRef.current);
    if (voiceObj) utterance.voice = voiceObj;
    utterance.rate = rateRef.current;
    utterance.pitch = pitchRef.current;

    utterance.onend = () => {
      if (singleRef.current) {
        // قراءة منفردة — توقف بعد الجملة
        singleRef.current = false;
        setIsPlaying(false);
        setCurrentIndex(-1);
        if (mediaRecorderRef.current) stopRecording();
      } else {
        playNext();
      }
    };
    utterance.onerror = () => {
      singleRef.current = false;
      setIsPlaying(false);
      if (mediaRecorderRef.current) stopRecording();
    };

    synthRef.current.speak(utterance);
  }, [stopRecording]);

  /**
   * يبدأ القراءة من جملة معينة.
   * @param {number} startIdx — فهرس بداية القراءة
   * @param {boolean} single — true: قراءة الجملة وحدها فقط
   */
  const speakFrom = useCallback((startIdx, single) => {
    if (!synthRef.current) return;
    const sents = sentencesRef.current;
    if (!sents.length || startIdx < 0 || startIdx >= sents.length) return;

    synthRef.current.cancel();
    singleRef.current = single;
    queueRef.current = single
      ? [startIdx]
      : sents.map((_, i) => i).slice(startIdx);
    setIsPlaying(true);
    playNext();
  }, [playNext]);

  /** تقسيم النص وقراءته بالكامل بالتتابع من الجملة الأولى (مع بدء التسجيل) */
  const speak = useCallback(async (text) => {
    if (!synthRef.current || !text) return;
    const sents = splitSentences(text);
    setSentences(sents);
    sentencesRef.current = sents;
    if (!sents.length) return;

    // مسح التنزيل السابق وبدء تسجيل جديد (إن كان مدعوماً)
    setAudioUrl(null);
    await startRecording();

    speakFrom(0, false);
  }, [speakFrom, startRecording]);

  /** قراءة جملة محددة منفردة (بدون متابعة الباقي) */
  const speakSentence = useCallback((index) => {
    if (!synthRef.current) return;
    const sents = sentencesRef.current;
    if (index < 0 || index >= sents.length) return;
    setCurrentIndex(index);
    setAudioUrl(null);
    speakFrom(index, true);
  }, [speakFrom]);

  /** إيقاف القراءة فوراً (وإلغاء التسجيل الجاري) */
  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    singleRef.current = false;
    queueRef.current = [];
    setIsPlaying(false);
    setCurrentIndex(-1);
    // إيقاف التسجيل إن كان يعمل — دون إنتاج ملف (إلغاء)
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      try { recorder.ondataavailable = null; } catch { /* ignore */ }
      try { recorder.onstop = null; } catch { /* ignore */ }
      if (recorder.state !== 'inactive') recorder.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach(t => t.stop());
      captureStreamRef.current = null;
    }
  }, []);

  /** تنظيف عنوان التنزيل عند تغيير النص */
  const clearAudio = useCallback(() => {
    setAudioUrl(null);
  }, []);

  return {
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
    sentences,
    currentIndex,
    // التسجيل
    audioUrl,
    isRecording,
    recorderSupported,
    clearAudio,
  };
};
