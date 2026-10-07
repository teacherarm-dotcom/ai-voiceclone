// ═══════════════════════════════════════════════════════════════════════════
// ai-voiceclone · geminiVoice — ตัวเรียก Gemini API ฝั่งเบราว์เซอร์ (key ของผู้ใช้)
//
//  • Voice Replication  POST /v1beta/voices  (type=replicated · source_audio + consent_audio)
//  • รายการ/ลบ voice     GET|DELETE /v1beta/voices[/{id}]
//  • สังเคราะห์เสียง    POST /v1beta/interactions (Gemini 3.8 Flash TTS — คืน WAV 24kHz)
//                        สำรอง: models/{m}:generateContent (responseModalities AUDIO · PCM ดิบ)
//
// อ้างอิง: https://ai.google.dev/gemini-api/docs/speech-generation
//          https://ai.google.dev/gemini-api/docs/voice-replication
// ⚠️ โมเดล TTS เป็นคนละสายกับโมเดลแชท — โมเดลแชทสร้างเสียงไม่ได้
// ═══════════════════════════════════════════════════════════════════════════

import { audioBase64ToBlob } from './audioTools.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export const TTS_MODELS = [
  { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS — คุณภาพสูง รองรับโคลนเสียง (แนะนำ)' },
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS — เร็ว ประหยัดโควต้า' },
];

/** โมเดลที่ใช้ "สร้าง" voice โคลน (ผูกกับ voice id ที่ได้ — ใช้สังเคราะห์ด้วย Flash/Lite ได้ทั้งคู่) */
export const CLONE_MODEL = 'gemini-3.8-flash-tts';

// 30 เสียงมาตรฐานของ Gemini TTS (ชื่อทางการ + คำอธิบายไทย) — ชุดเดียวกับ ai-tts
export const PREBUILT_VOICES = [
  { name: 'Zephyr', desc: 'สดใส กระฉับกระเฉง', g: 'F' },
  { name: 'Puck', desc: 'ร่าเริง มีชีวิตชีวา', g: 'M' },
  { name: 'Charon', desc: 'ให้ข้อมูล น่าเชื่อถือ', g: 'M' },
  { name: 'Kore', desc: 'หนักแน่น มั่นใจ', g: 'F' },
  { name: 'Fenrir', desc: 'ตื่นเต้น เร้าใจ', g: 'M' },
  { name: 'Leda', desc: 'สดใสวัยรุ่น', g: 'F' },
  { name: 'Orus', desc: 'หนักแน่น จริงจัง', g: 'M' },
  { name: 'Aoede', desc: 'สบายๆ เป็นธรรมชาติ', g: 'F' },
  { name: 'Callirrhoe', desc: 'ผ่อนคลาย เรื่อยๆ', g: 'F' },
  { name: 'Autonoe', desc: 'สดใส แจ่มใส', g: 'F' },
  { name: 'Enceladus', desc: 'เสียงลมหายใจ นุ่มลึก', g: 'M' },
  { name: 'Iapetus', desc: 'ชัดถ้อยชัดคำ', g: 'M' },
  { name: 'Umbriel', desc: 'สบายๆ เป็นกันเอง', g: 'M' },
  { name: 'Algieba', desc: 'นุ่มนวล ลื่นไหล', g: 'M' },
  { name: 'Despina', desc: 'นุ่มนวล อ่อนโยน', g: 'F' },
  { name: 'Erinome', desc: 'ชัดเจน สะอาด', g: 'F' },
  { name: 'Algenib', desc: 'แหบเสน่ห์', g: 'M' },
  { name: 'Rasalgethi', desc: 'ให้ข้อมูล เป็นทางการ', g: 'M' },
  { name: 'Laomedeia', desc: 'ร่าเริง กระตือรือร้น', g: 'F' },
  { name: 'Achernar', desc: 'อ่อนโยน เบาสบาย', g: 'F' },
  { name: 'Alnilam', desc: 'หนักแน่น ทรงพลัง', g: 'M' },
  { name: 'Schedar', desc: 'ราบเรียบ สม่ำเสมอ', g: 'M' },
  { name: 'Gacrux', desc: 'ผู้ใหญ่ อบอุ่น', g: 'F' },
  { name: 'Pulcherrima', desc: 'มั่นใจ โดดเด่น', g: 'F' },
  { name: 'Achird', desc: 'เป็นมิตร เข้าถึงง่าย', g: 'M' },
  { name: 'Zubenelgenubi', desc: 'สบายๆ ไม่เป็นทางการ', g: 'M' },
  { name: 'Vindemiatrix', desc: 'สุภาพ นุ่มนวล', g: 'F' },
  { name: 'Sadachbia', desc: 'มีชีวิตชีวา คึกคัก', g: 'M' },
  { name: 'Sadaltager', desc: 'รอบรู้ น่าฟัง', g: 'M' },
  { name: 'Sulafat', desc: 'อบอุ่น เป็นกันเอง', g: 'F' },
];

/**
 * ประโยคยินยอมที่ Google กำหนด — เจ้าของเสียงต้อง "อ่านให้ตรงทุกคำ" ลงในคลิป consent_audio
 * (ระบบของ Google ตรวจว่าผู้พูดคนเดียวกับเสียงต้นแบบ + พูดประโยคนี้จริง)
 */
export const CONSENT_PHRASES = {
  'th-TH': { label: 'ไทย', text: 'ฉันเป็นเจ้าของเสียงนี้ และฉันยินยอมให้ Google ใช้เสียงนี้เพื่อสร้างแบบจำลองเสียงสังเคราะห์' },
  'en-US': { label: 'English', text: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.' },
  'zh-CN': { label: '中文 (简体)', text: '我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型' },
};

export const isCustomVoice = (v) => /^voice(key)?_/.test(String(v || ''));

/** แยกคีย์จากสตริงที่คั่นด้วย , / ขึ้นบรรทัด / ช่องว่าง */
export function parseKeyString(s) {
  return [...new Set(String(s || '').split(/[\s,;]+/).map((k) => k.trim()).filter((k) => k.length >= 20))];
}

// ─────────────────────────────────────────────────────────────────
// ตัวยิง HTTP กลาง — แปลง error ของ Google ให้อ่านง่าย + ติด status
// ─────────────────────────────────────────────────────────────────

async function call(key, path, { method = 'GET', body, timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${API}/${path}${sep}key=${encodeURIComponent(key)}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = data?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      const err = new Error(friendlyError(res.status, msg));
      err.status = res.status;
      err.raw = msg;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`Gemini ใช้เวลานานกว่าปกติ (เกิน ${Math.round(timeoutMs / 1000)} วิ) — ระบบหยุดรอก่อน ลองใหม่อีกครั้ง`);
      err.status = 0;
      throw err;
    }
    if (!e.status && /Failed to fetch|NetworkError|Load failed/i.test(e.message || '')) {
      const err = new Error('ติดต่อ Gemini ไม่ได้ (เน็ตหลุด หรือเครือข่ายบล็อก generativelanguage.googleapis.com)');
      err.status = 0;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function quotaKind(status, msg) {
  if (status !== 429) return '';
  const m = String(msg || '');
  if (/per\s*day|PerDay|daily|GenerateRequestsPerDayPerProjectPerModel/i.test(m)) return 'rpd';
  return 'rpm';
}

function friendlyError(status, msg) {
  const m = String(msg || '');
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(m)) return 'API key ไม่ถูกต้อง — ตรวจคีย์ที่ตั้งไว้ (ต้องเป็นคีย์ Gemini จาก aistudio.google.com)';
  if (status === 401 || status === 403) return `คีย์ถูกปฏิเสธ (${status}) — คีย์ถูกบล็อก/ไม่มีสิทธิ์ใช้โมเดลนี้: ${m}`;
  if (status === 429) {
    return quotaKind(status, m) === 'rpd'
      ? 'โควต้ารายวันของคีย์นี้หมดแล้ว (TTS ระดับฟรีได้ ~10-15 ครั้ง/วัน/โมเดล) — รอวันพรุ่งนี้ หรือใช้คีย์อื่น'
      : 'ยิงถี่เกินไป (โควต้าต่อนาที) — รอสัก 30-60 วินาทีแล้วลองใหม่';
  }
  if (status === 404) return `ไม่พบปลายทาง/โมเดล (404) — ${m}`;
  if (status >= 500) return `Gemini ขัดข้องชั่วคราว (${status}) — ลองใหม่อีกครั้ง: ${m}`;
  if (/consent/i.test(m)) return `Google ปฏิเสธการโคลน: คลิปยินยอมไม่ผ่านการตรวจ (ต้องเป็นคนเดียวกับเสียงต้นแบบ และอ่านประโยคให้ตรงทุกคำ) — ${m}`;
  return m;
}

// ─────────────────────────────────────────────────────────────────
// Voice Replication
// ─────────────────────────────────────────────────────────────────

/**
 * สร้างเสียงโคลนจากเสียงต้นแบบ + เสียงยินยอม
 * @param {object} o
 * @param {string} o.key
 * @param {string} o.name            ชื่อที่จะโชว์ (display_name)
 * @param {string} o.sourceB64       WAV 24k mono base64 (10–30 วิ)
 * @param {string} o.consentB64      WAV 24k mono base64 — อ่านประโยคยินยอม
 * @param {boolean} [o.store=true]   true = เก็บที่ Google ได้ voice_… (1 ปี) · false = voicekey_… (7 วัน)
 * @param {string} [o.model]
 * @returns {Promise<{id:string, key:string, voiceRef:string, raw:object}>}
 */
export async function createReplicatedVoice(o) {
  const store = o.store !== false;
  const body = {
    store,
    voice: {
      model: o.model || CLONE_MODEL,
      type: 'replicated',
      display_name: String(o.name || 'My Voice').slice(0, 80),
      replicated: {
        source_audio: { mime_type: 'audio/wav', data: o.sourceB64 },
        consent_audio: { mime_type: 'audio/wav', data: o.consentB64 },
      },
    },
  };
  const data = await call(o.key, 'voices', { method: 'POST', body, timeoutMs: 180000 });
  const v = data?.voice || data || {};
  const id = v.id || v.voice_id || v.voiceId || '';
  const key = v.key || v.voice_key || v.voiceKey || '';
  const voiceRef = store ? (id || key) : (key || id);
  if (!voiceRef) {
    const err = new Error('Google ตอบกลับโดยไม่มี voice id — ' + JSON.stringify(data).slice(0, 300));
    err.status = 500;
    throw err;
  }
  return { id, key, voiceRef, raw: v, store };
}

/** รายการเสียงโคลนที่เก็บไว้ที่ Google ภายใต้โปรเจกต์ของคีย์นี้ */
export async function listReplicatedVoices(key) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < 10; i += 1) {
    const q = `voices?type=replicated&page_size=200${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await call(key, q, { timeoutMs: 60000 });
    const arr = data?.voices || data?.voice || [];
    for (const v of arr) out.push(v);
    pageToken = data?.next_page_token || data?.nextPageToken || '';
    if (!pageToken) break;
  }
  return out.filter((v) => (v.type || 'replicated') === 'replicated' || /^voice_/.test(v.id || ''));
}

export async function deleteVoice(key, id) {
  if (!/^voice_/.test(id)) throw new Error('ลบได้เฉพาะเสียงที่เก็บไว้ที่ Google (voice_…) — voicekey_… หมดอายุเองใน 7 วัน');
  await call(key, `voices/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 60000 });
  return true;
}

// ─────────────────────────────────────────────────────────────────
// สังเคราะห์เสียง
// ─────────────────────────────────────────────────────────────────

let interactionsUnavailable = false;  // จำไว้ทั้งหน้า: endpoint interactions ไม่มี → ใช้ generateContent เลย

/** ดึง base64 เสียงจากคำตอบ Interactions API (รองรับหลายทรงที่ docs/SDK เคยใช้) */
function pickInteractionAudio(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.output_audio?.data) return data.output_audio.data;
  if (data.outputAudio?.data) return data.outputAudio.data;
  const steps = data.steps || data.outputs || [];
  let last = null;
  for (const st of steps) {
    const content = st?.content || [];
    for (const c of content) {
      if (c?.type === 'audio' && c.data) last = c.data;
      if (c?.inline_data?.data) last = c.inline_data.data;
      if (c?.inlineData?.data) last = c.inlineData.data;
    }
    if (st?.type === 'audio' && st.data) last = st.data;
  }
  return last;
}

async function synthViaInteractions(key, { model, text, style, voice }) {
  const annotations = style ? [{ type: 'speech_metadata', style }] : [];
  const body = {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text, annotations }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  };
  const data = await call(key, 'interactions', { method: 'POST', body, timeoutMs: 180000 });
  const b64 = pickInteractionAudio(data);
  if (!b64) {
    const err = new Error('AI ไม่ส่งเสียงกลับมา (interactions) — ' + JSON.stringify(data).slice(0, 200));
    err.status = 500;
    throw err;
  }
  return audioBase64ToBlob(b64, 24000);
}

async function synthViaGenerateContent(key, { model, text, style, voice }) {
  const voiceConfig = isCustomVoice(voice)
    ? { voice }
    : { prebuiltVoiceConfig: { voiceName: voice } };
  const body = {
    contents: [{ role: 'user', parts: [{ text: style ? `${style}: ${text}` : text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig } },
  };
  const data = await call(key, `models/${model}:generateContent`, { method: 'POST', body, timeoutMs: 180000 });
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
  if (!part) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || '';
    const err = new Error(reason ? `AI ไม่ส่งเสียงกลับมา (${reason})` : 'AI ไม่ส่งเสียงกลับมา');
    err.status = 500;
    throw err;
  }
  const rate = parseInt((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1] || '24000', 10);
  return audioBase64ToBlob(part.inlineData.data, rate);
}

/**
 * ข้อความ → Blob เสียง (WAV) ด้วยเสียงที่เลือก (prebuilt หรือ voice_/voicekey_ ที่โคลนไว้)
 * หมุนคีย์เมื่อติดโควต้า · สลับโมเดล Flash ⇄ Lite เมื่อ 429/5xx (โควต้าแยกรายโมเดล)
 * @param {object} o
 * @param {string[]} o.keys       เรียงลำดับที่จะลอง (ตัวแรกสุด = คีย์ที่สร้าง voice นี้ ถ้ารู้)
 * @param {string} o.text
 * @param {string} o.voice
 * @param {string} [o.style]      คำกำกับอารมณ์/สไตล์ (ภาษาอะไรก็ได้)
 * @param {string} [o.model]
 * @param {function} [o.onLog]
 * @returns {Promise<{blob:Blob, model:string, keyTail:string}>}
 */
export async function synthesize(o) {
  const keys = Array.isArray(o.keys) ? o.keys.filter(Boolean) : parseKeyString(o.keys);
  if (!keys.length) throw new Error('ยังไม่ได้ตั้งค่า Gemini API Key');
  const text = String(o.text || '').trim();
  if (!text) throw new Error('ไม่มีข้อความให้สร้างเสียง');
  const log = typeof o.onLog === 'function' ? o.onLog : () => {};
  const primary = o.model || TTS_MODELS[0].id;
  const models = [primary, ...TTS_MODELS.map((m) => m.id).filter((id) => id !== primary)];
  const style = String(o.style || '').trim();
  const voice = o.voice || 'Kore';
  let lastErr = null;

  for (const key of keys) {
    for (const model of models) {
      const args = { model, text, style, voice };
      try {
        let blob;
        if (!interactionsUnavailable) {
          try {
            blob = await synthViaInteractions(key, args);
          } catch (e) {
            // ปลายทาง interactions ยังไม่เปิดให้คีย์นี้/บัญชีนี้ → ใช้ generateContent แทน (จำไว้ทั้งหน้า)
            if (e.status === 404 || (e.status === 400 && /Unknown name|Invalid JSON payload|not supported/i.test(e.raw || ''))) {
              log(`interactions → ${e.status} ใช้ generateContent แทน`);
              interactionsUnavailable = true;
              blob = await synthViaGenerateContent(key, args);
            } else throw e;
          }
        } else {
          blob = await synthViaGenerateContent(key, args);
        }
        if (model !== primary) log(`ใช้โมเดลสำรอง: ${model}`);
        return { blob, model, keyTail: key.slice(-6) };
      } catch (e) {
        lastErr = e;
        const st = e.status || 0;
        if (st === 429 || st >= 500) { log(`${model} + key …${key.slice(-4)} → ${st} ลองโมเดล/คีย์ถัดไป`); continue; }
        if (st === 403 && keys.length > 1) { log(`key …${key.slice(-4)} ถูกปฏิเสธ (403) ลองคีย์ถัดไป`); break; }
        throw e;
      }
    }
  }
  throw lastErr || new Error('สร้างเสียงไม่สำเร็จ');
}
