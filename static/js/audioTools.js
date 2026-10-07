// ═══════════════════════════════════════════════════════════════════════════
// ai-voiceclone · audioTools — อัดเสียงในเบราว์เซอร์ + แปลงไฟล์เสียงใด ๆ เป็น WAV 24kHz mono 16-bit
//
// Gemini Voice Replication แนะนำ "24kHz mono 16-bit PCM WAV" ทั้ง source_audio และ consent_audio
// → ทำให้ครบในเบราว์เซอร์ด้วย Web Audio (decodeAudioData + OfflineAudioContext resample)
//   ไม่ต้องมี ffmpeg ฝั่งเซิร์ฟเวอร์ และไฟล์เสียงไม่ต้องออกจากเครื่องผู้ใช้ก่อนถึง Google
// ═══════════════════════════════════════════════════════════════════════════

export const TARGET_RATE = 24000;

/** mime ที่ MediaRecorder ของเบราว์เซอร์นี้รองรับ (Chrome/Edge/Firefox = webm/opus · Safari = mp4) */
export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  return cands.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
}

/**
 * ตัวอัดเสียงจากไมโครโฟน — start() ขอสิทธิ์ไมค์แล้วเริ่มอัด · stop() คืน Blob
 * @param {object} o
 * @param {number} [o.maxSeconds]   หยุดเองเมื่อครบ (กันอัดยาวเกินที่ API ต้องการ)
 * @param {function} [o.onTick]     เรียกทุก ~200ms ด้วยจำนวนวินาทีที่อัดไปแล้ว
 */
export class Recorder {
  constructor(o = {}) {
    this.maxSeconds = o.maxSeconds || 0;
    this.onTick = typeof o.onTick === 'function' ? o.onTick : () => {};
    this.rec = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
    this.timer = null;
    this.mime = pickRecorderMime();
    this._stopResolve = null;
  }

  get active() { return !!(this.rec && this.rec.state === 'recording'); }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับการอัดเสียง — ใช้ Chrome/Edge/Safari รุ่นใหม่ หรืออัปโหลดไฟล์เสียงแทน');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('เบราว์เซอร์นี้ไม่มี MediaRecorder — อัปโหลดไฟล์เสียงแทน');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน — กดอนุญาตที่แถบที่อยู่ของเบราว์เซอร์ แล้วลองใหม่ (หรืออัปโหลดไฟล์เสียงแทน)');
      }
      if (name === 'NotFoundError') throw new Error('ไม่พบไมโครโฟนในเครื่องนี้ — อัปโหลดไฟล์เสียงแทน');
      throw new Error(`เปิดไมโครโฟนไม่ได้: ${e?.message || name || 'unknown'}`);
    }
    this.chunks = [];
    this.rec = this.mime ? new MediaRecorder(this.stream, { mimeType: this.mime }) : new MediaRecorder(this.stream);
    this.rec.addEventListener('dataavailable', (ev) => { if (ev.data && ev.data.size) this.chunks.push(ev.data); });
    this.rec.start(250);
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      const s = (Date.now() - this.startedAt) / 1000;
      this.onTick(s);
      if (this.maxSeconds && s >= this.maxSeconds) this.stop();
    }, 200);
  }

  /** หยุดอัด → Blob (mime ตาม MediaRecorder) · เรียกซ้ำได้ ปลอดภัย */
  stop() {
    if (!this.rec) return Promise.resolve(null);
    if (this._stopPromise) return this._stopPromise;
    clearInterval(this.timer);
    this.timer = null;
    const rec = this.rec;
    const type = rec.mimeType || this.mime || 'audio/webm';
    this._stopPromise = new Promise((resolve) => {
      const done = () => {
        this._release();
        const blob = new Blob(this.chunks, { type });
        this.rec = null;
        this._stopPromise = null;
        resolve(blob);
      };
      rec.addEventListener('stop', done, { once: true });
      if (rec.state !== 'inactive') rec.stop(); else done();
    });
    return this._stopPromise;
  }

  cancel() {
    clearInterval(this.timer);
    this.timer = null;
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch { /* ignore */ }
    this._release();
    this.rec = null;
    this.chunks = [];
  }

  _release() {
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    this.stream = null;
  }
}

// ─────────────────────────────────────────────────────────────────
// แปลงเสียงใด ๆ → WAV 24kHz mono 16-bit (+ base64)
// ─────────────────────────────────────────────────────────────────

let _ctx = null;
function audioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Audio');
  if (!_ctx) _ctx = new AC();
  return _ctx;
}

/** decodeAudioData แบบรองรับทั้ง promise (Chrome/Firefox) และ callback (Safari เก่า) */
function decode(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    } catch (e) { reject(e); return; }
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

/**
 * ไฟล์/Blob เสียง (webm/mp4/mp3/wav/ogg…) → { blob: WAV 24k mono 16-bit, base64, seconds, trimmed }
 * @param {Blob} input
 * @param {object} [o]
 * @param {number} [o.maxSeconds]  ตัดให้เหลือไม่เกินนี้ (Gemini แนะนำ 10–30 วิ สำหรับเสียงต้นแบบ)
 */
export async function toWav24k(input, o = {}) {
  if (!input || !input.size) throw new Error('ไม่มีข้อมูลเสียง');
  const ctx = audioCtx();
  let decoded;
  try {
    decoded = await decode(ctx, await input.arrayBuffer());
  } catch (e) {
    throw new Error(`อ่านไฟล์เสียงไม่ได้ (${input.type || 'ไม่ทราบชนิด'}) — ลองใช้ไฟล์ .wav/.mp3/.m4a หรืออัดใหม่: ${e?.message || ''}`.trim());
  }
  const srcLen = decoded.length;
  const dur = decoded.duration;
  const trimmed = !!(o.maxSeconds && dur > o.maxSeconds + 0.05);
  const keepSec = trimmed ? o.maxSeconds : dur;
  const outLen = Math.max(1, Math.ceil(keepSec * TARGET_RATE));
  if (!srcLen || dur < 0.2) throw new Error('ไฟล์เสียงสั้นเกินไป');

  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, outLen, TARGET_RATE);   // 1 channel = downmix สเตอริโอให้เอง
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const f32 = rendered.getChannelData(0);

  // normalize เบา ๆ ให้ความดังพอเหมาะ (ไมค์โน้ตบุ๊กมักเบา) — ไม่แตะถ้าดังอยู่แล้ว
  let peak = 0;
  for (let i = 0; i < f32.length; i += 1) { const a = Math.abs(f32[i]); if (a > peak) peak = a; }
  const gain = peak > 0.01 && peak < 0.6 ? 0.9 / peak : 1;

  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i += 1) {
    const v = Math.max(-1, Math.min(1, f32[i] * gain));
    i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const blob = pcm16ToWavBlob(i16, TARGET_RATE);
  return {
    blob,
    base64: await blobToBase64(blob),
    seconds: f32.length / TARGET_RATE,
    trimmed,
    originalSeconds: dur,
    peak,
  };
}

/** Int16 PCM mono → Blob WAV (RIFF header) */
export function pcm16ToWavBlob(i16, sampleRate = TARGET_RATE) {
  const bytes = i16.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  new Int16Array(buf, 44).set(i16);
  return new Blob([buf], { type: 'audio/wav' });
}

/** base64 → Uint8Array */
export function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Blob → base64 (ไม่มี prefix data:) — ใช้ FileReader กัน stack overflow กับไฟล์ใหญ่ */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.readAsDataURL(blob);
  });
}

/**
 * เสียงที่ Gemini ส่งกลับ (base64) → Blob ที่เล่นได้
 * · ขึ้นต้น "RIFF" = WAV แล้ว ใช้ตรง ๆ · ไม่ใช่ = PCM 16-bit ดิบ → ห่อ WAV header ให้
 */
export function audioBase64ToBlob(b64, sampleRate = TARGET_RATE) {
  const bytes = base64ToBytes(b64);
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return new Blob([bytes], { type: 'audio/wav' });
  }
  const even = bytes.length - (bytes.length % 2);
  const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, even / 2);
  return pcm16ToWavBlob(i16, sampleRate);
}

/** ความยาว (วินาที) ของ WAV 16-bit mono จาก Blob — ประมาณจากขนาดไฟล์ */
export function wavSeconds(blob, sampleRate = TARGET_RATE) {
  if (!blob || blob.size <= 44) return 0;
  return (blob.size - 44) / (sampleRate * 2);
}

export function fmtSecs(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(t / 60);
  const r = t % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
