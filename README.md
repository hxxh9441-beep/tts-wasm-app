# 🔊 نص → صوت (TTS Only — WASM)

تطبيق **تحويل النص إلى كلام** — نسخة خفيفة وسريعة من المشروع الكامل:
- محرك **Piper** عبر WASM — يعمل على كل الأجهزة والمتصفحات بلا استثناء
- **أوفلاين بالكامل** بعد أول استخدام (الأصوات تُخزَّن محلياً عبر Cache API)
- **Zero-Data**: لا يُرفع أي نص أو صوت — كل شيء على جهازك
- واجهة عربي/إنجليزي داكنة + PWA قابل للتثبيت

## التطوير

```bash
npm install
npm run dev        # خادم التطوير
npm run build      # بناء الإنتاج (dist/)
npm run preview    # معاينة البناء
```

## النشر

المشروع جاهز للنشر على:
- **Cloudflare Pages** (Upload assets من `dist/` — رؤوس WebGPU موجودة في `public/_headers`)
- **GitHub Pages** (سير عمل تلقائي في `.github/workflows/deploy.yml` — فعّل Settings → Pages → Source: GitHub Actions)

## الأصوات

| الصوت | اللغة | المصدر |
|---|---|---|
| كريم | عربي | rhasspy/piper-voices (ar_JO-kareem-medium) |
| عمرو | عربي | kimbolingo/arabic-piper-tts |
| زينة | عربي | arabic-emirati-female |
| ليساك | إنجليزي | en_US-lessac-medium |

الأصوات تُنزَّل **عند أول استخدام فقط** (~60MB) ثم تُخزَّن محلياً للأبد.
