import { useState, useEffect, useRef } from 'react';

export const useWebSpeechTTS = () => {
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null);

  // مرجع محدّث للصوت المختار — يمنع إعادة تعيين اختيار المستخدم
  // عند تكرار حدث onvoiceschanged (بعض المتصفحات يطلقونه عدة مرات)
  const selectedVoiceRef = useRef(selectedVoice);
  selectedVoiceRef.current = selectedVoice;

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

  const speak = (text) => {
    if (!synthRef.current || !text) return;
    synthRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voiceObj = voices.find(v => v.name === selectedVoice);
    if (voiceObj) utterance.voice = voiceObj;

    utterance.rate = rate;
    utterance.pitch = pitch;

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    synthRef.current.speak(utterance);
  };

  const stop = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsPlaying(false);
    }
  };

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
    speak,
    stop,
    isPlaying,
    rate,
    setRate,
    pitch,
    setPitch
  };
};
