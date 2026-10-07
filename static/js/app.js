// ═══════════════════════════════════════════════════════════════════════════
// ai-voiceclone · app.js — UI ทั้งหมด (โคลนเสียง / ข้อความ→เสียง / คลังเสียงโคลน)
// ═══════════════════════════════════════════════════════════════════════════

import { Recorder, toWav24k, fmtSecs, wavSeconds } from './audioTools.js';
import {
  TTS_MODELS, PREBUILT_VOICES, CONSENT_PHRASES, parseKeyString, isCustomVoice,
  createReplicatedVoice, listReplicatedVoices, deleteVoice, synthesize,
} from './geminiVoice.js';
import { busyStart } from './busyModal.js';

// 🔑 คีย์กลางของระบบครูอาร์ม — `ai_apikey_gemini` ใช้ร่วมกับ planner/ML/ai-tts (origin เดียวกันบน dles)
const LS_KEYS_SHARED = 'ai_apikey_gemini';
const LS_VOICES = 'vc_voicesV1';
const LS_PREF = 'vc_prefsV1';

const REF_MAX_SEC = 30;       // Gemini แนะนำ 10–30 วิ
const REF_MIN_SEC = 5;
const CONSENT_MAX_SEC = 20;
const CONSENT_MIN_SEC = 2;

const STYLE_PRESETS = [
  ['👩‍🏫 ครูสอน', 'อ่านแบบครูอธิบายบทเรียน ใจเย็น ชัดเจน เน้นคำสำคัญ'],
  ['📰 ผู้ประกาศ', 'อ่านแบบผู้ประกาศข่าว ชัดถ้อยชัดคำ จังหวะมั่นคง'],
  ['😊 ร่าเริง', 'น้ำเสียงร่าเริง สดใส เป็นมิตร'],
  ['😌 สงบ', 'น้ำเสียงสงบ นุ่มนวล ช้าๆ ผ่อนคลาย'],
  ['📖 เล่าเรื่อง', 'เล่าเรื่องชวนติดตาม มีจังหวะขึ้นลงตามอารมณ์'],
  ['📢 โฆษณา', 'มีพลัง ดึงดูดความสนใจ แบบสปอตโฆษณา'],
  ['🐢 ช้าชัด', 'อ่านช้ากว่าปกติ ชัดถ้อยชัดคำ'],
];

const $ = (s) => document.querySelector(s);

const state = {
  ref: null,        // {blob, base64, seconds}
  consent: null,
  voices: [],       // เสียงโคลน [{id, name, model, keyTail, createdAt, stored}]
  history: [],      // {label, blob, url, secs}
  lastBlob: null,
  busy: false,
};
const recorders = { ref: null, consent: null };

// ═══════════════════ helpers ═══════════════════

function loadJson(k, dflt) { try { return JSON.parse(localStorage.getItem(k) || '') ?? dflt; } catch { return dflt; } }
function saveJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/private mode */ } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function msg(sel, text, kind = 'error') {
  const el = $(sel);
  if (!el) return;
  el.innerHTML = text ? `<div class="alert ${kind}">${esc(text)}</div>` : '';
}
function log(line) {
  const el = $('#log');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent += `${new Date().toLocaleTimeString('th-TH')} ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

const ON_DLES = () => { try { return /(^|\.)dles\.vec\.go\.th$/.test(window.location.hostname); } catch { return false; } };

// ═══════════════════ API keys ═══════════════════

function getKeys() { return parseKeyString(localStorage.getItem(LS_KEYS_SHARED) || ''); }

/** ซิงก์จากคลังคีย์ตามบัญชี dles (/api/ai-keys) — เงียบเสมอ ห้ามทับของเดิมด้วยค่าว่าง */
async function syncSharedKeys() {
  if (!ON_DLES()) return;
  try {
    const r = await fetch('/api/ai-keys?provider=gemini', { credentials: 'same-origin', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return;
    const j = await r.json();
    const keys = typeof j?.keys === 'string' ? j.keys.trim() : '';
    if (j?.ok && keys) localStorage.setItem(LS_KEYS_SHARED, keys);
  } catch { /* ignore */ }
}

function updateKeyUi() {
  const n = getKeys().length;
  const st = $('#keyStatus');
  if (n) {
    st.className = 'key-status hidden';
    st.innerHTML = '';
  } else {
    // ไม่มีช่องกรอกคีย์ในหน้านี้ (เจ้าของสั่ง 2026-10-07 — เหมือน ai-tts): ตั้งที่ระบบทำแผนการสอนที่เดียว
    st.className = 'key-status off';
    st.innerHTML = ON_DLES()
      ? '⚠️ ยังไม่มีคีย์ Gemini ในบัญชีนี้ — ตั้งค่าคีย์ครั้งเดียวที่ <a href="/lesson-plan" target="_blank" rel="noopener">ระบบทำแผนการสอน → ปุ่ม “ตั้งค่า AI”</a> แล้วกลับมาหน้านี้ (ใช้คีย์ร่วมกันทุกระบบ)'
      : '⚠️ ยังไม่มี Gemini API Key ในเบราว์เซอร์นี้ — รันแบบ standalone ให้ตั้งค่าครั้งเดียวใน Console: <code>localStorage.setItem(\'ai_apikey_gemini\', \'AIza…\')</code> แล้วรีเฟรช';
  }
}

/** คีย์ที่ควรลองก่อนสำหรับเสียงนี้ — เสียงโคลนผูกกับโปรเจกต์ของคีย์ที่สร้าง */
function keysFor(voiceRef) {
  const keys = getKeys();
  const v = state.voices.find((x) => x.id === voiceRef);
  if (!v?.keyTail) return keys;
  const pri = keys.filter((k) => k.endsWith(v.keyTail));
  return [...pri, ...keys.filter((k) => !k.endsWith(v.keyTail))];
}

// ═══════════════════ voices roster ═══════════════════

function loadVoices() { state.voices = loadJson(LS_VOICES, []); if (!Array.isArray(state.voices)) state.voices = []; }
function saveVoices() { saveJson(LS_VOICES, state.voices); }

function renderVoiceSelect() {
  const sel = $('#voiceSelect');
  const prev = sel.value || loadJson(LS_PREF, {}).voice || 'Kore';
  const custom = state.voices.map((v) => `<option value="${esc(v.id)}">🎙️ ${esc(v.name)}${v.stored ? '' : ' (ชั่วคราว 7 วัน)'}</option>`).join('');
  const pre = PREBUILT_VOICES.map((v) => `<option value="${v.name}">${v.name} — ${v.desc} (${v.g === 'F' ? 'หญิง' : 'ชาย'})</option>`).join('');
  sel.innerHTML = (custom ? `<optgroup label="เสียงที่โคลนไว้">${custom}</optgroup>` : '')
    + `<optgroup label="เสียงมาตรฐาน Gemini (30 เสียง)">${pre}</optgroup>`;
  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : (state.voices[0]?.id || 'Kore');
  updateVoiceDesc();
}

function updateVoiceDesc() {
  const v = $('#voiceSelect').value;
  const el = $('#voiceDesc');
  if (isCustomVoice(v)) {
    const c = state.voices.find((x) => x.id === v);
    el.textContent = c ? `เสียงโคลน "${c.name}" · สร้างเมื่อ ${new Date(c.createdAt).toLocaleString('th-TH')}${c.keyTail ? ` · คีย์ …${c.keyTail}` : ''}` : 'เสียงโคลน';
  } else {
    const p = PREBUILT_VOICES.find((x) => x.name === v);
    el.textContent = p ? `เสียงมาตรฐาน ${p.name} — ${p.desc}` : '';
  }
  savePref({ voice: v });
}

function renderVoiceTable() {
  const tb = $('#voiceTable tbody');
  $('#libEmpty').classList.toggle('hidden', state.voices.length > 0);
  $('#voiceTable').classList.toggle('hidden', state.voices.length === 0);
  tb.innerHTML = state.voices.map((v, i) => `
    <tr>
      <td><span class="name"><i class="fa-solid fa-microphone-lines"></i>${esc(v.name)}</span>${v.stored ? '' : ' <span class="warn">(ชั่วคราว)</span>'}</td>
      <td><code title="${esc(v.id)}">${esc(v.id.length > 34 ? `${v.id.slice(0, 30)}…` : v.id)}</code></td>
      <td>${v.createdAt ? new Date(v.createdAt).toLocaleDateString('th-TH') : '-'}</td>
      <td class="row" style="gap:4px">
        <button class="btn secondary small" data-use="${i}"><i class="fa-solid fa-check"></i> ใช้เสียงนี้</button>
        <button class="btn secondary small" data-copy="${i}" title="คัดลอกรหัส"><i class="fa-regular fa-copy"></i></button>
        <button class="btn danger small" data-del="${i}"><i class="fa-regular fa-trash-can"></i> ลบ</button>
      </td>
    </tr>`).join('');
}

function addVoice(v) {
  state.voices = state.voices.filter((x) => x.id !== v.id);
  state.voices.unshift(v);
  saveVoices();
  renderVoiceSelect();
  renderVoiceTable();
}

function savePref(patch) { saveJson(LS_PREF, { ...loadJson(LS_PREF, {}), ...patch }); }

// ═══════════════════ recording / upload ═══════════════════

function clipUi(kind) {
  return {
    btn: $(kind === 'ref' ? '#btnRecRef' : '#btnRecConsent'),
    timer: $(kind === 'ref' ? '#timerRef' : '#timerConsent'),
    box: $(kind === 'ref' ? '#clipRef' : '#clipConsent'),
    audio: $(kind === 'ref' ? '#audioRef' : '#audioConsent'),
    status: $(kind === 'ref' ? '#statusRef' : '#statusConsent'),
    label: kind === 'ref' ? 'อัดเสียงต้นแบบ' : 'อัดเสียงยินยอม',
    max: kind === 'ref' ? REF_MAX_SEC : CONSENT_MAX_SEC,
    min: kind === 'ref' ? REF_MIN_SEC : CONSENT_MIN_SEC,
  };
}

async function setClip(kind, blob, sourceLabel) {
  const ui = clipUi(kind);
  msg('#cloneMsg', '');
  ui.status.textContent = 'กำลังแปลงเป็น WAV 24kHz…';
  ui.box.classList.remove('hidden');
  try {
    const wav = await toWav24k(blob, { maxSeconds: ui.max });
    state[kind] = wav;
    if (ui.audio.src) URL.revokeObjectURL(ui.audio.src);
    ui.audio.src = URL.createObjectURL(wav.blob);
    const secs = wav.seconds;
    let note = `${sourceLabel} · ${secs.toFixed(1)} วิ`;
    let cls = 'ok';
    if (wav.trimmed) note += ` (ตัดจาก ${wav.originalSeconds.toFixed(0)} วิ ให้เหลือ ${ui.max} วิ)`;
    if (secs < ui.min) { note += ` — สั้นเกินไป ควร ≥ ${kind === 'ref' ? '10' : '3'} วิ`; cls = 'warn'; }
    else if (kind === 'ref' && secs < 10) { note += ' — แนะนำ 10–30 วิ เพื่อคุณภาพที่ดีกว่า'; cls = 'warn'; }
    if (wav.peak < 0.02) { note += ' — เสียงเบามาก/เงียบ ตรวจไมค์แล้วอัดใหม่'; cls = 'err'; }
    ui.status.innerHTML = `<span class="${cls}">${esc(note)}</span>`;
  } catch (e) {
    state[kind] = null;
    ui.status.innerHTML = `<span class="err">${esc(e.message)}</span>`;
    ui.audio.removeAttribute('src');
  }
  updateCloneBtn();
}

async function toggleRecord(kind) {
  const ui = clipUi(kind);
  const other = kind === 'ref' ? 'consent' : 'ref';
  if (recorders[other]?.active) { msg('#cloneMsg', 'กำลังอัดอีกคลิปอยู่ — หยุดคลิปนั้นก่อน'); return; }
  if (recorders[kind]?.active) {
    await recorders[kind].stop();   // ตัว stop ถูกห่อไว้ให้จัดการปุ่ม/คลิปเอง (ด้านล่าง)
    return;
  }
  const rec = new Recorder({
    maxSeconds: ui.max,
    onTick: (s) => { ui.timer.textContent = `● ${fmtSecs(s)} / ${fmtSecs(ui.max)}`; },
  });
  recorders[kind] = rec;
  try {
    await rec.start();
  } catch (e) {
    recorders[kind] = null;
    msg('#cloneMsg', e.message);
    return;
  }
  msg('#cloneMsg', '');
  ui.btn.classList.add('on');
  ui.btn.innerHTML = '<i class="fa-solid fa-stop"></i> หยุดอัด';
  // ทางจบมี 2 ทาง (กดหยุดเอง / ครบเวลาแล้วหยุดเอง) → ห่อ stop ให้จัดการ UI + คลิปที่เดียว
  const origStop = rec.stop.bind(rec);
  let finished = false;
  rec.stop = () => {
    const p = origStop();
    if (!finished) {
      finished = true;
      ui.btn.classList.remove('on');
      ui.btn.innerHTML = `<i class="fa-solid fa-microphone"></i> ${ui.label}`;
      ui.timer.textContent = '';
      p.then((blob) => {
        recorders[kind] = null;
        if (blob && blob.size > 0) setClip(kind, blob, 'อัดจากไมค์');
        else msg('#cloneMsg', 'ไม่ได้ข้อมูลเสียงจากไมค์ — ลองอัดใหม่หรืออัปโหลดไฟล์');
      });
    }
    return p;
  };
}

function updateCloneBtn() {
  const ok = !!(state.ref && state.consent) && !state.busy;
  $('#btnClone').disabled = !ok;
  $('#cloneHint').textContent = state.ref && state.consent
    ? 'พร้อมแล้ว — กดสร้าง (ใช้เวลาราว 10–60 วินาที)'
    : (state.ref ? 'ยังขาดเสียงยินยอม (ข้อ C)' : 'ต้องมีทั้งเสียงต้นแบบและเสียงยินยอมก่อน');
}

// ═══════════════════ clone ═══════════════════

async function doClone() {
  const keys = getKeys();
  if (!keys.length) { msg('#cloneMsg', 'ยังไม่มี Gemini API Key — ใส่ที่แผง ⚙️ ก่อน'); return; }
  if (!state.ref || !state.consent) return;
  const name = $('#voiceName').value.trim() || `เสียงของฉัน ${new Date().toLocaleDateString('th-TH')}`;
  const store = $('#storeVoice').checked;
  state.busy = true;
  updateCloneBtn();
  msg('#cloneMsg', '');
  const b = busyStart('น้องเพชรกำลังส่งเสียงไปให้ Google ตรวจและสร้างเสียงโคลน', 'ราว 10–60 วินาที · อย่าปิดหน้านี้');
  try {
    let lastErr = null;
    let created = null;
    let usedKey = '';
    for (const key of keys) {
      try {
        created = await createReplicatedVoice({ key, name, sourceB64: state.ref.base64, consentB64: state.consent.base64, store });
        usedKey = key;
        break;
      } catch (e) {
        lastErr = e;
        if (e.status === 429 || e.status >= 500) { log(`clone key …${key.slice(-4)} → ${e.status} ลองคีย์ถัดไป`); continue; }
        // คีย์นี้เป็นระดับฟรี (403 Paid Tier) — คีย์ถัดไปอาจเป็นโปรเจกต์ที่ผูกบัตรแล้ว ลองต่อ
        if (e.status === 403 && keys.length > 1) { log(`clone key …${key.slice(-4)} → 403 ลองคีย์ถัดไป`); continue; }
        throw e;
      }
    }
    if (!created) throw lastErr || new Error('สร้างเสียงโคลนไม่สำเร็จ');
    addVoice({ id: created.voiceRef, name, model: 'gemini-3.8-flash-tts', keyTail: usedKey.slice(-6), createdAt: Date.now(), stored: store });
    $('#voiceSelect').value = created.voiceRef;
    updateVoiceDesc();
    msg('#cloneMsg', `✅ สร้างเสียงโคลน "${name}" สำเร็จ — รหัส ${created.voiceRef}\nเลือกใช้ได้แล้วที่ข้อ 2️⃣ (ตั้งให้เป็นเสียงที่เลือกอยู่แล้ว)`, 'success');
    $('#ttsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    msg('#cloneMsg', `สร้างเสียงโคลนไม่สำเร็จ: ${e.message}`);
    log(`clone error: ${e.message}`);
  } finally {
    b.end();
    state.busy = false;
    updateCloneBtn();
  }
}

// ═══════════════════ speak ═══════════════════

function showResult(label, blob, meta) {
  const box = $('#resultBox');
  const audio = $('#resultAudio');
  if (audio.src) URL.revokeObjectURL(audio.src);
  const url = URL.createObjectURL(blob);
  audio.src = url;
  $('#resultLabel').textContent = label;
  $('#resultMeta').textContent = meta;
  box.classList.remove('hidden');
  state.lastBlob = blob;
  state.lastLabel = label;
  audio.play().catch(() => { /* autoplay ถูกบล็อก — ผู้ใช้กดเล่นเอง */ });

  state.history.unshift({ label, blob, url: URL.createObjectURL(blob), secs: wavSeconds(blob) });
  state.history = state.history.slice(0, 10);
  $('#history').innerHTML = state.history.map((h, i) => `
    <li><span class="label" title="${esc(h.label)}">${esc(h.label)}</span>
      <span class="muted">${h.secs.toFixed(1)} วิ</span>
      <audio controls preload="none" src="${h.url}"></audio>
      <button class="btn secondary small" data-dl="${i}" title="ดาวน์โหลด"><i class="fa-solid fa-download"></i></button></li>`).join('');
}

function safeName(s) { return String(s || 'voice').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

async function doSpeak(sampleMode = false) {
  const keys = getKeys();
  if (!keys.length) { msg('#ttsMsg', 'ยังไม่มี Gemini API Key — ใส่ที่แผง ⚙️ ก่อน'); return; }
  const voice = $('#voiceSelect').value;
  const text = sampleMode
    ? 'สวัสดีค่ะ นี่คือตัวอย่างเสียงจากระบบ NITED AI Tools ยินดีต้อนรับสู่การเรียนรู้ในวันนี้'
    : $('#ttsText').value.trim();
  if (!text) { msg('#ttsMsg', 'พิมพ์ข้อความที่ต้องการให้พูดก่อน'); $('#ttsText').focus(); return; }
  if (state.busy) return;
  state.busy = true;
  $('#btnSpeak').disabled = true;
  $('#btnSample').disabled = true;
  msg('#ttsMsg', '');
  const style = sampleMode ? '' : $('#styleInput').value.trim();
  const model = $('#modelSelect').value;
  const b = busyStart(sampleMode ? 'น้องเพชรกำลังขอตัวอย่างเสียง' : 'น้องเพชรกำลังสร้างเสียงพูดจากข้อความ', `${text.length.toLocaleString()} ตัวอักษร · อย่าปิดหน้านี้`);
  const t0 = Date.now();
  try {
    const r = await synthesize({ keys: keysFor(voice), text, voice, style, model, onLog: log });
    const vLabel = isCustomVoice(voice) ? (state.voices.find((x) => x.id === voice)?.name || 'เสียงโคลน') : voice;
    const secs = (Date.now() - t0) / 1000;
    const snippet = text.length > 50 ? `${text.slice(0, 50)}…` : text;
    showResult(`${vLabel}: ${snippet}`, r.blob, `${wavSeconds(r.blob).toFixed(1)} วิ · ${r.model} · ${secs.toFixed(1)} วิ`);
    savePref({ style, model });
  } catch (e) {
    msg('#ttsMsg', `สร้างเสียงไม่สำเร็จ: ${e.message}`);
    log(`speak error: ${e.message}`);
  } finally {
    b.end();
    state.busy = false;
    $('#btnSpeak').disabled = false;
    $('#btnSample').disabled = false;
    updateCloneBtn();
  }
}

// ═══════════════════ library sync / delete ═══════════════════

async function syncFromGoogle() {
  const keys = getKeys();
  if (!keys.length) { msg('#libMsg', 'ยังไม่มี Gemini API Key'); return; }
  msg('#libMsg', '');
  const b = busyStart('น้องเพชรกำลังดึงรายการเสียงโคลนจาก Google');
  try {
    let total = 0;
    let added = 0;
    const errors = [];
    for (const key of keys) {
      try {
        const list = await listReplicatedVoices(key);
        total += list.length;
        for (const v of list) {
          const id = v.id || v.key;
          if (!id) continue;
          if (!state.voices.some((x) => x.id === id)) {
            state.voices.push({ id, name: v.display_name || v.displayName || id, model: v.model || '', keyTail: key.slice(-6), createdAt: Date.parse(v.create_time || v.createTime || '') || Date.now(), stored: true });
            added += 1;
          }
        }
      } catch (e) { errors.push(`…${key.slice(-4)}: ${e.message}`); }
    }
    saveVoices();
    renderVoiceSelect();
    renderVoiceTable();
    const txt = `พบ ${total} เสียงที่ Google · เพิ่มใหม่ ${added} รายการ${errors.length ? `\n${errors.join('\n')}` : ''}`;
    msg('#libMsg', txt, errors.length && !total ? 'error' : 'info');
  } finally { b.end(); }
}

async function removeVoice(i) {
  const v = state.voices[i];
  if (!v) return;
  const fromGoogle = /^voice_/.test(v.id) && window.confirm(`ลบ "${v.name}" ออกจาก Google ด้วยไหม?\n\nตกลง = ลบถาวรที่ Google (ใช้ไม่ได้อีก)\nยกเลิก = เอาออกจากรายการในเครื่องนี้อย่างเดียว`);
  if (fromGoogle) {
    const b = busyStart('กำลังลบเสียงโคลนที่ Google');
    try {
      let done = false;
      let lastErr = null;
      for (const key of keysFor(v.id)) {
        try { await deleteVoice(key, v.id); done = true; break; } catch (e) { lastErr = e; if (e.status === 404) { done = true; break; } }
      }
      if (!done) { msg('#libMsg', `ลบที่ Google ไม่สำเร็จ: ${lastErr?.message || ''}`); return; }
    } finally { b.end(); }
  }
  state.voices.splice(i, 1);
  saveVoices();
  renderVoiceSelect();
  renderVoiceTable();
  msg('#libMsg', fromGoogle ? `ลบ "${v.name}" ที่ Google แล้ว` : `เอา "${v.name}" ออกจากรายการในเครื่องนี้แล้ว`, 'info');
}

// ═══════════════════ init ═══════════════════

function init() {
  // ประโยคยินยอม
  const langSel = $('#consentLang');
  langSel.innerHTML = Object.entries(CONSENT_PHRASES).map(([code, p]) => `<option value="${code}">${p.label}</option>`).join('');
  const pref = loadJson(LS_PREF, {});
  langSel.value = CONSENT_PHRASES[pref.consentLang] ? pref.consentLang : 'th-TH';
  const renderConsent = () => { $('#consentText').textContent = `“${CONSENT_PHRASES[langSel.value].text}”`; savePref({ consentLang: langSel.value }); };
  langSel.addEventListener('change', renderConsent);
  renderConsent();

  // โมเดล / สไตล์
  $('#modelSelect').innerHTML = TTS_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  if (TTS_MODELS.some((m) => m.id === pref.model)) $('#modelSelect').value = pref.model;
  if (pref.style) $('#styleInput').value = pref.style;
  $('#styleChips').innerHTML = STYLE_PRESETS.map(([l, v]) => `<button type="button" class="chip" data-style="${esc(v)}">${l}</button>`).join('');
  $('#styleChips').addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-style]');
    if (c) $('#styleInput').value = c.dataset.style;
  });

  // คีย์
  loadVoices();
  updateKeyUi();
  syncSharedKeys().then(() => updateKeyUi());
  // เสียง
  renderVoiceSelect();
  renderVoiceTable();
  $('#voiceSelect').addEventListener('change', updateVoiceDesc);

  // อัด / อัปโหลด
  $('#btnRecRef').addEventListener('click', () => toggleRecord('ref'));
  $('#btnRecConsent').addEventListener('click', () => toggleRecord('consent'));
  $('#fileRef').addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (f) setClip('ref', f, f.name); ev.target.value = ''; });
  $('#fileConsent').addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (f) setClip('consent', f, f.name); ev.target.value = ''; });
  $('#btnClone').addEventListener('click', doClone);

  // พูด
  const tt = $('#ttsText');
  const cc = () => { $('#charCount').textContent = `(${tt.value.length.toLocaleString()}/4,000)`; };
  tt.addEventListener('input', cc);
  cc();
  $('#btnSpeak').addEventListener('click', () => doSpeak(false));
  $('#btnSample').addEventListener('click', () => doSpeak(true));
  $('#btnDownload').addEventListener('click', () => {
    if (state.lastBlob) download(state.lastBlob, `${safeName(state.lastLabel?.split(':')[0])}-${Date.now()}.wav`);
  });
  $('#history').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-dl]');
    if (!b) return;
    const h = state.history[Number(b.dataset.dl)];
    if (h) download(h.blob, `${safeName(h.label.split(':')[0])}-${Date.now()}.wav`);
  });

  // คลัง
  $('#btnSyncVoices').addEventListener('click', syncFromGoogle);
  $('#voiceTable').addEventListener('click', async (ev) => {
    const use = ev.target.closest('[data-use]');
    const del = ev.target.closest('[data-del]');
    const copy = ev.target.closest('[data-copy]');
    if (use) {
      const v = state.voices[Number(use.dataset.use)];
      if (v) { $('#voiceSelect').value = v.id; updateVoiceDesc(); $('#ttsCard').scrollIntoView({ behavior: 'smooth' }); }
    } else if (copy) {
      const v = state.voices[Number(copy.dataset.copy)];
      if (v) { try { await navigator.clipboard.writeText(v.id); msg('#libMsg', `คัดลอกรหัส ${v.id} แล้ว`, 'info'); } catch { window.prompt('รหัสเสียง:', v.id); } }
    } else if (del) {
      await removeVoice(Number(del.dataset.del));
    }
  });

  updateCloneBtn();
  window.addEventListener('beforeunload', () => { Object.values(recorders).forEach((r) => r?.cancel()); });
}

init();
