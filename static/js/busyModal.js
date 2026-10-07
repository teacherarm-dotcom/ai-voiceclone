// ═══════════════════════════════════════════════════════════════════════════
// ai-voiceclone · busyModal (สำเนาจาก ai-tts — แก้ที่ต้นทางแล้ว copy มา) — ป๊อปอัป "น้องเพชร" ผู้ช่วย AI ขณะระบบกำลังประมวลผล
// (เจ้าของสั่ง 2026-08-08 — ชุดเดียวกับน้องพลอย v3Full / น้องหยก co-businesses)
//
// หลักการเดียวกับ YokLoadingModal: **นับงานค้าง** (counter) ไม่ใช่ boolean
//   → งานซ้อนกัน (เช่น outline + สคริปต์รายสไลด์) ปิดป๊อปอัปเมื่อ "ทุกงานจบ" เท่านั้น
// ต่างที่นี่เป็น vanilla JS (ไม่มี React) → สร้าง DOM + CSS ครั้งเดียวตอนเรียกใช้ครั้งแรก
//
// ใช้:  const b = busyStart('น้องเพชรกำลัง...');  b.text('อัปเดตสถานะ');  b.end();
//       (หรือ busyText() อัปเดตข้อความของงานที่ค้างอยู่ตัวล่าสุด)
// รูปน้องเพชร: วางไฟล์ที่ static/img/phet.png (ไม่มี → ใช้ avatar 💎 สำรองอัตโนมัติ)
// ⚠️ path รูปต้อง relative เสมอ — หน้าเว็บถูกฝังใต้ proxy `/voiceclone/app/` (กฎ CLAUDE.md)
// ═══════════════════════════════════════════════════════════════════════════

const TOP_GAP = 28;   // ระยะจากขอบบนของช่วงที่เห็น ถึงกล่องน้องเพชร

let count = 0;
let root = null;
let elText = null;
let elSub = null;

function ensure() {
  if (root) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  root = document.createElement('div');
  root.className = 'phet-bg';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <div class="phet-card">
      <div class="phet-avatar-wrap">
        <img src="static/img/phet.png" alt="น้องเพชร" class="phet-avatar" id="phetImg">
        <div class="phet-avatar phet-avatar-fallback" id="phetFallback" hidden>💎</div>
      </div>
      <div class="phet-name">น้องเพชร <span>ผู้ช่วย AI</span></div>
      <div class="phet-title" id="phetText">น้องเพชรกำลังประมวลผล<span class="phet-dots"></span></div>
      <div class="phet-bar"><span></span></div>
      <div class="phet-note" id="phetSub">ระบบกำลังทำงาน โปรดอย่าปิดหน้านี้</div>
    </div>`;
  document.body.appendChild(root);

  // ไม่มีไฟล์รูป → สลับไปใช้ avatar สำรองเงียบ ๆ (ไม่ทิ้งรูปแตกไว้บนจอ)
  const img = root.querySelector('#phetImg');
  img.addEventListener('error', () => {
    img.hidden = true;
    root.querySelector('#phetFallback').hidden = false;
  });
  elText = root.querySelector('#phetText');
  elSub = root.querySelector('#phetSub');
}

/**
 * ช่วงแนวตั้งของหน้านี้ที่ "ผู้ใช้เห็นจริง" (พิกัดในหน้าเรา)
 *
 * ทำไมต้องคำนวณเอง: `position:fixed` ยึดกับ viewport ของหน้าตัวเอง — พอหน้านี้ถูกฝังใน iframe
 * ที่ตั้งความสูง "เท่าเนื้อหา" (โมดูลสร้าง Clip Video ของ Micro Learning ใช้ scrolling=no +
 * ยืดสูงตาม scrollHeight เพื่อให้มี scrollbar อันเดียว) viewport ของเรากลายเป็น 2,000–3,000px
 * ⇒ กึ่งกลางของมันไปโผล่กลาง "เอกสาร" ไม่ใช่กลางสายตาคน (เจ้าของแจ้ง 2026-08-08 "หน้าจอยาวมาก")
 * → ไต่ขึ้นไปทีละชั้น เอาช่วงที่หน้าแม่มองเห็นมาตัดกัน (same-origin เท่านั้น · ข้ามโดเมนก็ใช้เท่าที่ได้)
 */
function viewBand() {
  let top = 0;
  let bottom = window.innerHeight;
  let shift = 0;            // ระยะแปลงพิกัด "หน้าแม่ชั้นที่กำลังดู" → "หน้าเรา"
  let win = window;
  try {
    while (win.frameElement) {
      const r = win.frameElement.getBoundingClientRect();   // ตำแหน่งกรอบเราในพิกัดหน้าแม่
      shift -= r.top;
      top = Math.max(top, shift);
      bottom = Math.min(bottom, win.parent.innerHeight + shift);
      win = win.parent;
    }
  } catch { /* cross-origin → ใช้เท่าที่คำนวณได้ */ }
  return { top, bottom };
}

/** วางกล่องชิด "ขอบบนของช่วงที่เห็น" เสมอ (เจ้าของสั่ง: อย่าลอยกลางจอ ให้เลื่อนขึ้นข้างบน) */
function place() {
  if (!root) return;
  const { top, bottom } = viewBand();
  const card = root.querySelector('.phet-card');   // ⚠️ ห้ามใช้ firstElementChild — อาจเป็น <style>
  const h = card ? card.offsetHeight : 380;
  let y = top + TOP_GAP;
  // เบียดขึ้นก็ต่อเมื่อ "รู้ขอบล่างจริง" — บางจังหวะ innerHeight คืน 0 (แท็บยังไม่ถูกวาด) แล้วจะดันไปติดขอบบน
  if (bottom > top + 120 && y + h > bottom) y = Math.max(top, bottom - h - 12);
  root.style.paddingTop = `${Math.round(y)}px`;
}

// เฝ้าเลื่อน/ปรับขนาดของทุกชั้นที่เข้าถึงได้ — ป๊อปอัปต้องตามสายตาไปตลอดที่ยังทำงานอยู่
let unwatch = null;
function watch() {
  if (unwatch) return;
  const wins = [];
  try {
    let win = window;
    while (win) { wins.push(win); win = win.frameElement ? win.parent : null; }
  } catch { /* ไต่ได้แค่ไหนเอาแค่นั้น */ }
  const on = () => place();
  wins.forEach((w) => {
    try { w.addEventListener('scroll', on, { passive: true }); w.addEventListener('resize', on); } catch { /* ข้ามชั้นที่แตะไม่ได้ */ }
  });
  unwatch = () => {
    wins.forEach((w) => { try { w.removeEventListener('scroll', on); w.removeEventListener('resize', on); } catch { /* noop */ } });
    unwatch = null;
  };
}

function render() {
  if (!root) return;
  const on = count > 0;
  root.classList.toggle('show', on);
  if (on) { place(); watch(); } else if (unwatch) { unwatch(); }
}

/** ตั้งข้อความสถานะ (บรรทัดหลัก) — เก็บจุดกระพริบไว้ท้ายเสมอ */
export function busyText(text, sub) {
  ensure();
  if (text) elText.innerHTML = `${escapeHtml(text)}<span class="phet-dots"></span>`;
  if (sub !== undefined) elSub.textContent = sub || 'ระบบกำลังทำงาน โปรดอย่าปิดหน้านี้';
}

/**
 * เริ่มงาน 1 ชิ้น → คืนตัวคุมงานนั้น { text, end }
 * ⚠️ ต้องเรียก .end() ใน finally เสมอ ไม่งั้นป๊อปอัปค้าง
 */
export function busyStart(text, sub) {
  ensure();
  count += 1;
  busyText(text || 'น้องเพชรกำลังประมวลผล', sub);
  render();
  let ended = false;
  return {
    text: (t, s) => busyText(t, s),
    end: () => {
      if (ended) return;            // กันเรียกซ้ำแล้วตัวนับติดลบ
      ended = true;
      count = Math.max(0, count - 1);
      render();
    },
  };
}

/** ปิดทุกงาน (ใช้เมื่อ reset หน้า/เจอ error ที่ทำให้ไม่แน่ใจว่าค้างกี่งาน) */
export function busyReset() {
  count = 0;
  render();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CSS = `
.phet-bg{ position:fixed; inset:0; z-index:10000; display:none; justify-items:center; align-items:start;
  padding:16px; background:rgba(15,23,42,.55); backdrop-filter:blur(3px); }
.phet-bg.show{ display:grid; }
.phet-card{ background:#fff; border-radius:20px; padding:30px 38px 24px; text-align:center; width:min(92vw,420px);
  box-shadow:0 24px 70px rgba(0,0,0,.35); font-family:'Sarabun',sans-serif; }
.phet-avatar-wrap{ width:128px; height:128px; margin:0 auto 2px; padding:4px; border-radius:50%;
  background:linear-gradient(135deg,#22d3ee,#a855f7); animation:phet-float 2.4s ease-in-out infinite; }
.phet-avatar{ width:100%; height:100%; border-radius:50%; display:block; object-fit:cover; object-position:center 15%;
  background:#f5f3ff; border:2px solid #fff; }
.phet-avatar-fallback{ display:grid; place-items:center; font-size:56px; line-height:1;
  background:linear-gradient(135deg,#22d3ee,#a855f7); }
/* ⚠️ ต้องมีบรรทัดนี้เสมอ: display:block/grid ด้านบน "ชนะ" display:none ของ [hidden] จาก UA stylesheet
   → ถ้าไม่ใส่ จะเห็น avatar 2 วงซ้อนกัน (รูปหลัก+ตัวสำรอง) ตลอดเวลา — เจอจริงตอน verify 2026-08-08 */
.phet-avatar[hidden]{ display:none; }
@keyframes phet-float{ 0%,100%{ transform:translateY(0); box-shadow:0 6px 16px rgba(34,211,238,.30);} 50%{ transform:translateY(-8px); box-shadow:0 18px 30px rgba(168,85,247,.42);} }
.phet-name{ font-weight:800; font-size:16px; color:#7c3aed; margin-top:10px; }
.phet-name span{ font-weight:500; font-size:12.5px; color:#94a3b8; }
.phet-title{ font-weight:700; font-size:15.5px; color:#1e293b; margin-top:6px; white-space:pre-line; min-height:20px; }
.phet-dots::after{ display:inline-block; content:''; animation:phet-dots 1.4s steps(1,end) infinite; }
@keyframes phet-dots{ 0%{content:'';} 25%{content:'.';} 50%{content:'..';} 75%,100%{content:'...';} }
.phet-bar{ height:8px; border-radius:99px; background:#eef2f7; overflow:hidden; margin-top:16px; }
.phet-bar span{ display:block; height:100%; width:42%; border-radius:99px;
  background:linear-gradient(90deg,#22d3ee,#a855f7); animation:phet-slide 1.15s ease-in-out infinite alternate; }
@keyframes phet-slide{ from{margin-left:0;} to{margin-left:58%;} }
.phet-note{ font-size:12.5px; color:#64748b; margin-top:12px; }
`;
