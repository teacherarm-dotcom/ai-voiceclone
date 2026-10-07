#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ai-voiceclone — โคลนเสียง (Voice Replication) + สร้างเสียงพูดจากข้อความ ด้วย Gemini 3.8 Flash TTS

สถาปัตยกรรม (แบบเดียวกับ ai-tts): Flask เสิร์ฟหน้าเว็บอย่างเดียว ไม่มี API ฝั่งเซิร์ฟเวอร์
การเรียก Gemini (สร้าง voice / สังเคราะห์เสียง) ทำฝั่งเบราว์เซอร์ด้วย API key ของผู้ใช้
→ เสียงต้นแบบ / เสียงยินยอม / key ไม่เคยผ่านเซิร์ฟเวอร์นี้
"""
import os

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# ── Shared-secret guard (เมื่อฝังใน dles-landing ผ่าน proxy /voiceclone/app/*) ──
# ตั้ง env AI_VOICECLONE_SHARED_SECRET ให้ตรงกับ VOICECLONE_SHARED_SECRET ฝั่ง dles
# → รับเฉพาะ request จาก proxy · ไม่ตั้ง (dev/standalone) → ไม่ตรวจ เข้าตรงได้
_SHARED_SECRET = os.environ.get("AI_VOICECLONE_SHARED_SECRET", "")


@app.before_request
def _guard_secret():
    if not _SHARED_SECRET:
        return None
    if request.path == "/health":
        return None
    if request.headers.get("X-Vc-Secret") != _SHARED_SECRET:
        return ("Forbidden — ต้องเข้าผ่านระบบ NITED", 403)
    return None


@app.after_request
def _no_cache_html(resp):
    # หน้าเว็บ/JS เปลี่ยนบ่อย — กัน proxy/เบราว์เซอร์แคชของเก่าจนครูเห็นหน้าเดิมหลัง deploy
    if resp.mimetype in ("text/html", "application/javascript", "text/javascript", "text/css"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify(ok=True, app="ai-voiceclone")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5460))
    app.run(host="0.0.0.0", port=port, debug=True)
