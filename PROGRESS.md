# PROGRESS — ai-voiceclone

## 2026-10-07 ✅ สร้างระบบครั้งแรก (เจ้าของสั่ง: โคลนเสียงด้วย gemini-3.8-flash-tts + กล่องข้อความ + dropdown เสียง Gemini · อยู่ใน NITED AI Tools · ขึ้น GitHub เฉพาะโฟลเดอร์นี้)
- Flask เสิร์ฟหน้าเดียว · Gemini เรียกจากเบราว์เซอร์: POST /v1beta/voices (replicated) · POST /v1beta/interactions (สำรอง generateContent) · อัด/อัปโหลด → WAV 24k ในเบราว์เซอร์
- verify ด้วย mock fetch ในเบราว์เซอร์จริง (ดู CLAUDE.md) · ⚠️ ยังไม่ได้ยิงคีย์จริง
- prod: NSSM ai-voiceclone :5460 + dles /voiceclone (dles-landing ae1d8731)
