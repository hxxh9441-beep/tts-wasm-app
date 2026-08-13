import { useState, useEffect, useRef, useCallback } from 'react';
import { splitSentences } from '../utils/textUtils';

/**
 * هوك تحويل النص إلى كلام عبر Web Speech API — مع تقسيم وتتبع الجمل:
 * - يقسم النص إلى جمل ويعرضها
 * - يقرأ الجمل بالتتابع (Queue) — عند انتهاء الجملة ينتقل تلقائياً للتالية
 * - يتيح قراءة أي جملة منفردة (Speak Single)
 */
export const useWebSpeechTTS = () => {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [sentences, setSentences] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

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

  // طابور القراءة: فهارس الجمل المتبقية + وضع القراءة المنفردة
  const queueRef = useRef([]);
  const singleRef = useRef(false);

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

  /** تشغيل الجملة التالية في الطابور — تُستدعى من onend للانتقال التلقائي */
  const playNext = useCallback(() => {
    const sents = sentencesRef.current;
    const queue = queueRef.current;

    if (!queue.length) {
      setIsPlaying(false);
      setCurrentIndex(-1);
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
      } else {
        playNext(); // الانتقال التلقائي للجملة التالية
      }
    };
    utterance.onerror = () => {
      singleRef.current = false;
      setIsPlaying(false);
    };

    synthRef.current.speak(utterance);
  }, []);

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

  /** تقسيم النص وقراءته بالكامل بالتتابع من الجملة الأولى */
  const speak = useCallback((text) => {
    if (!synthRef.current || !text) return;
    const sents = splitSentences(text);
    setSentences(sents);
    sentencesRef.current = sents;
    if (!sents.length) return;
    speakFrom(0, false);
  }, [speakFrom]);

  /** قراءة جملة محددة منفردة (بدون متابعة الباقي) */
  const speakSentence = useCallback((index) => {
    if (!synthRef.current) return;
    const sents = sentencesRef.current;
    if (index < 0 || index >= sents.length) return;
    setCurrentIndex(index);
    speakFrom(index, true);
  }, [speakFrom]);

  /** إيقاف القراءة فوراً */
  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    singleRef.current = false;
    queueRef.current = [];
    setIsPlaying(false);
    setCurrentIndex(-1);
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
  };
};
