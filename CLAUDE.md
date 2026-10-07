# ai-voiceclone — โคลนเสียง (Voice Replication) + ข้อความ→เสียง ด้วย Gemini 3.8 Flash TTS

พี่น้องของ `ai-tts` (โครงเดียวกัน: Flask เสิร์ฟหน้าเว็บ · Gemini เรียกจากเบราว์เซอร์ด้วยคีย์ผู้ใช้)
· GitHub: `teacherarm-dotcom/ai-voiceclone` (public · repo แยก — **เฉพาะโฟลเดอร์นี้** ตามคำสั่งเจ้าของ 2026-10-07)

## รัน
```bash
pip3 install -r requirements.txt
PORT=5460 python3 app.py      # http://localhost:5460  (รันผ่าน shell — preview spawn python3 โดน TCC บล็อก)
```

## 🚀 Prod: dles.vec.go.th/voiceclone (NITED AI Tools หมวด "เสียงพากย์ & Text-to-Speech")
- เอนจินบนเซิร์ฟเวอร์ dles: `C:\ai-voiceclone\` NSSM service **`ai-voiceclone`** (`C:/Python312/python.exe serve.py` → **127.0.0.1:5460**)
  env: `AI_VOICECLONE_SHARED_SECRET` = `VOICECLONE_SHARED_SECRET` ใน `C:\dles-landing\.env` + `VOICECLONE_ENGINE_URL=http://127.0.0.1:5460`
- ฝั่ง dles-landing: `app/(portal)/voiceclone/page.tsx` (EmbedFullscreen **`allowExtra="microphone"`** — ไม่ใส่ = ปุ่มอัดเสียงใช้ไม่ได้ใน iframe)
  + proxy `app/(portal)/voiceclone/app/[[...path]]/route.ts` (session gate + header `X-Vc-Secret` + ฉีด `<base href>`) + การ์ด `lib/ai-tools.ts`
- **แก้โค้ดที่นี่ → deploy = `kscp` ไฟล์ขึ้น `C:/ai-voiceclone/` + `nssm restart ai-voiceclone`** (ไม่ต้อง build dles) · แก้ `templates/index.html` ต้อง restart (Jinja cache) · `static/*` เสิร์ฟสด
- ⚠️ **path ใน index.html/JS ต้อง relative เสมอ** (`static/...`) — proxy ฉีด `<base href="/voiceclone/app/">` · ขึ้นต้น `/` = หลุด proxy
- `/api/ai-keys?provider=gemini` (absolute) = ซิงก์คีย์จากคลังคีย์บัญชี dles — ใช้คีย์กลาง `ai_apikey_gemini` ร่วมกับ planner/ML/ai-tts
- 🔑 **ไม่มีช่องกรอก API key ในหน้านี้ (เจ้าของสั่ง 2026-10-07 "เอา api key ออกจาก github" — แบบเดียวกับ ai-tts 2026-08-08)** · เหลือแถบสถานะ: บน dles ชี้ไปตั้งที่ระบบทำแผน · standalone บอกให้ตั้งผ่าน Console · ⛔ ห้ามเอาแผงกรอกคีย์กลับมา · ⛔ ห้ามมีค่าคีย์/secret จริงในรีโป (ตรวจแล้ว ไม่เคยมีทั้งใน tree และ history)

## API ที่ใช้ (อ้างอิง docs Google 2026-10)
- **สร้างเสียงโคลน**: `POST /v1beta/voices?key=…` body `{store, voice:{model:'gemini-3.8-flash-tts', type:'replicated', display_name, replicated:{source_audio:{mime_type:'audio/wav',data}, consent_audio:{…}}}}`
  → `id: voice_…` (store=true · 200 เสียง/โปรเจกต์ · 1 ปี) หรือ `key: voicekey_…` (store=false · 7 วัน)
  · ทั้ง 2 คลิปต้อง **ไมค์เดียวกัน/ที่เดียวกัน** · consent ต้องอ่านประโยคของ Google ตรงทุกคำ (`CONSENT_PHRASES` ไทย/อังกฤษ/จีน) · Google ตรวจผู้พูดคนเดียวกัน
- **สังเคราะห์**: `POST /v1beta/interactions` `{model, input:[{type:'user_input', content:[{type:'text', text, annotations:[{type:'speech_metadata', style}]}]}], response_format:{type:'audio'}, generation_config:{speech_config:[{voice}]}}`
  → `steps[].content[]{type:'audio', data}` = **WAV 24kHz มี RIFF header แล้ว** (ไม่ใช่ PCM ดิบแบบ 2.5) · `audioBase64ToBlob` ดูไบต์ RIFF เอง ห่อ WAV ให้ถ้าเป็น PCM ดิบ
  · สำรอง `models/{m}:generateContent` (`speechConfig.voiceConfig` = `{voice}` สำหรับ voice_… / `{prebuiltVoiceConfig}` สำหรับ 30 เสียงมาตรฐาน) เมื่อ interactions ตอบ 404/400 Unknown name — จำไว้ทั้งหน้า (`interactionsUnavailable`)
- โมเดล `gemini-3.8-flash-tts` (หลัก) ⇄ `gemini-3.8-flash-lite-tts` (สำรอง — โควต้าแยกรายโมเดล) · ⛔ โมเดลแชทสร้างเสียงไม่ได้ · ⛔ ห้ามใส่ `gemini-2.5-*` กลับ (กฎกลาง 2026-09-06)
- **เสียงโคลนผูกกับโปรเจกต์ของคีย์ที่สร้าง** → roster เก็บ `keyTail` แล้ว `keysFor(voice)` เรียงคีย์นั้นมาก่อนตอนสังเคราะห์/ลบ

## กฎ/กับดัก
- **เสียงทุกไฟล์แปลงฝั่งเบราว์เซอร์** (`audioTools.toWav24k`: decodeAudioData → OfflineAudioContext 1ch 24k → Int16 → WAV) ⛔ ไม่มี ffmpeg/ไม่ส่งไฟล์ผ่านเซิร์ฟเวอร์เรา · ref ตัดที่ 30 วิ · consent 20 วิ · normalize เบา ๆ เมื่อ peak < 0.6
- `Recorder.stop` ถูกห่อใน `toggleRecord` ให้จบทางเดียว (กดหยุดเอง/ครบเวลาหยุดเอง) — ⛔ อย่าเรียก `setClip` ซ้ำ 2 ทาง (เคยได้คลิปซ้อน)
- ป๊อปอัปน้องเพชร (`busyModal.js` สำเนาจาก ai-tts) — `b.end()` ใน `finally` เสมอ
- โครง roster: localStorage `vc_voicesV1` `[{id, name, model, keyTail, createdAt, stored}]` · prefs `vc_prefsV1` · ⛔ ห้ามเก็บคีย์ API ที่อื่นนอก `ai_apikey_gemini`
- สำเนา busyModal/phet.png: แก้ที่ ai-tts ก่อนแล้ว copy มา (path รูปเป็น relative `static/img/phet.png`)

## Verify (2026-10-07 — ไม่มีคีย์จริงในเครื่อง ใช้ mock fetch ตามมาตรฐาน ai-tts)
เบราว์เซอร์จริง: อัปโหลด WAV 40 วิ → ตัดเหลือ 30.0 วิ ✓ · consent 5 วิ ✓ · POST voices body ถูกทรง (type/model/display_name/source+consent base64 1.92M/320K) ✓
· interactions body `speech_config:[{voice:'voice_…'}]` + `speech_metadata.style` ✓ · ผลเล่นได้ 1.5 วิ + ประวัติ ✓ · ฟังตัวอย่าง Kore ✓ · ดึงรายการจาก Google merge 2 รายการ ✓
· interactions 404 → generateContent สำรอง ✓ · 429 รายวัน → ข้อความ "โควต้ารายวันหมด" ✓ · ⚠️ **ยังไม่ได้ยิง API จริง** — เจ้าของทดสอบด้วยคีย์จริงครั้งแรก ถ้า field ไม่ตรง ดู `#log` ท้ายการ์ดข้อ 2
