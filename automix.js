// ==UserScript==
// @name         AutoMix
// @description  Apple Music-style AutoMix: crossfade, beat-match, and smart fade based on BPM + energy
// @version      1.0.0
// @author       spicetify-automix
// ==/UserScript==

(function AutoMix() {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────────────────────
  const STORAGE_KEY = "automix:settings";
  const SPOTIFY_API = "https://api.spotify.com/v1";

  // ─── Default Settings ────────────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    enabled: false,
    crossfadeDuration: 6,     // seconds
    beatMatchSensitivity: 0.8, // 0.0–1.0
    energyBlend: true,
    smartQueue: true,
    fadeMode: "smart",        // "crossfade" | "beatmatch" | "smart"
    minBpmMatch: 15,          // max BPM difference for beat-match
  };

  // ─── State ───────────────────────────────────────────────────────────────────
  let settings = { ...DEFAULT_SETTINGS };
  let audioContext = null;
  let gainNode = null;
  let currentTrackFeatures = null;
  let nextTrackFeatures = null;
  let transitionTimer = null;
  let isTransitioning = false;
  let trackFeatureCache = {};

  // ─── Utility: Load / Save settings ───────────────────────────────────────────
  function loadSettings() {
    try {
      const saved = Spicetify.LocalStorage.get(STORAGE_KEY);
      if (saved) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {
      console.warn("[AutoMix] Could not load settings:", e);
    }
  }

  function saveSettings() {
    try {
      Spicetify.LocalStorage.set(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn("[AutoMix] Could not save settings:", e);
    }
  }

  // ─── Spotify API helpers ──────────────────────────────────────────────────────
  async function getAccessToken() {
    return Spicetify.Platform?.AuthorizationAPI?._tokenProvider?._accessToken ||
           Spicetify.Platform?.Session?.accessToken ||
           null;
  }

  async function fetchTrackFeatures(trackId) {
    if (trackFeatureCache[trackId]) return trackFeatureCache[trackId];
    try {
      const token = await getAccessToken();
      if (!token) return null;
      const res = await fetch(`${SPOTIFY_API}/audio-features/${trackId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      trackFeatureCache[trackId] = data;
      return data;
    } catch (e) {
      console.warn("[AutoMix] fetchTrackFeatures error:", e);
      return null;
    }
  }

  async function fetchRecommendations(seedTrackId, features) {
    try {
      const token = await getAccessToken();
      if (!token) return [];
      const params = new URLSearchParams({
        seed_tracks: seedTrackId,
        target_tempo: features.tempo,
        target_energy: features.energy,
        target_valence: features.valence,
        target_danceability: features.danceability,
        min_tempo: Math.max(60, features.tempo - settings.minBpmMatch),
        max_tempo: features.tempo + settings.minBpmMatch,
        limit: 5,
      });
      const res = await fetch(`${SPOTIFY_API}/recommendations?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.tracks || [];
    } catch (e) {
      console.warn("[AutoMix] fetchRecommendations error:", e);
      return [];
    }
  }

  // ─── Audio Engine ─────────────────────────────────────────────────────────────
  function initAudioContext() {
    if (audioContext) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
    } catch (e) {
      console.warn("[AutoMix] AudioContext init failed:", e);
    }
  }

  // ─── Transition Logic ─────────────────────────────────────────────────────────

  /**
   * Calculate the ideal crossfade duration based on BPM difference and energy.
   */
  function calcCrossfadeDuration(current, next) {
    if (!current || !next) return settings.crossfadeDuration;

    const bpmDiff = Math.abs(current.tempo - next.tempo);
    const energyDiff = Math.abs(current.energy - next.energy);

    // Longer fade for large energy differences
    let duration = settings.crossfadeDuration;
    duration += energyDiff * 4;
    // Shorter fade when BPM is closely matched
    if (bpmDiff < 5) duration = Math.max(3, duration - 2);

    return Math.min(Math.max(duration, 2), 12);
  }

  /**
   * Determine the best transition mode for two tracks.
   * "beatmatch" → BPM close, smart fade not needed
   * "smart"     → energy-aware blend
   * "crossfade" → fallback
   */
  function resolveTransitionMode(current, next) {
    if (settings.fadeMode !== "smart") return settings.fadeMode;
    if (!current || !next) return "crossfade";
    const bpmDiff = Math.abs(current.tempo - next.tempo);
    if (bpmDiff <= settings.minBpmMatch && current.key === next.key) return "beatmatch";
    if (settings.energyBlend) return "smart";
    return "crossfade";
  }

  /**
   * Perform the actual fade transition through Spicetify's audio/volume API.
   */
  async function performTransition(fadeDuration, mode) {
    if (isTransitioning) return;
    isTransitioning = true;

    const steps = 50;
    const stepMs = (fadeDuration * 1000) / steps;

    // Easing: ease-in-out
    function easeInOut(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    // For beatmatch: faster fade-in and hold
    const fadeInCurve = mode === "beatmatch"
      ? (t) => Math.pow(t, 0.6)
      : easeInOut;

    // Fade out current track
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const vol = 1 - easeInOut(t);
      try {
        Spicetify.Platform?.PlaybackAPI?.setVolume?.(Math.max(0, vol));
      } catch {}
      await sleep(stepMs);
    }

    // Skip to next track
    try {
      await Spicetify.Player.next();
    } catch {}

    await sleep(200);

    // Fade in next track
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const vol = fadeInCurve(t);
      try {
        Spicetify.Platform?.PlaybackAPI?.setVolume?.(Math.min(1, vol));
      } catch {}
      await sleep(stepMs);
    }

    isTransitioning = false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Smart Queue ──────────────────────────────────────────────────────────────
  async function smartQueueNextTrack(currentFeatures) {
    if (!settings.smartQueue || !currentFeatures) return;

    const currentUri = Spicetify.Player.data?.item?.uri;
    if (!currentUri) return;
    const trackId = currentUri.split(":").pop();

    const recommendations = await fetchRecommendations(trackId, currentFeatures);
    if (!recommendations.length) return;

    // Score tracks by BPM + energy match
    const scored = await Promise.all(
      recommendations.map(async (track) => {
        const feat = await fetchTrackFeatures(track.id);
        if (!feat) return null;
        const bpmScore = 1 - Math.abs(feat.tempo - currentFeatures.tempo) / 100;
        const energyScore = 1 - Math.abs(feat.energy - currentFeatures.energy);
        const keyBonus = feat.key === currentFeatures.key ? 0.15 : 0;
        const total = bpmScore * 0.5 + energyScore * 0.35 + keyBonus;
        return { track, feat, score: total };
      })
    );

    const valid = scored.filter(Boolean).sort((a, b) => b.score - a.score);
    const best = valid[0];
    if (!best) return;

    try {
      await Spicetify.Platform?.PlayerAPI?.addToQueue?.([
        { uri: best.track.uri },
      ]);
      console.info(
        `[AutoMix] Queued: ${best.track.name} (BPM ${Math.round(best.feat.tempo)}, score ${best.score.toFixed(2)})`
      );
    } catch (e) {
      console.warn("[AutoMix] Could not add to queue:", e);
    }
  }

  // ─── Track Change Handler ──────────────────────────────────────────────────────
  async function onTrackChange() {
    if (!settings.enabled) return;

    const item = Spicetify.Player.data?.item;
    if (!item) return;

    const trackId = item.uri.split(":").pop();
    const features = await fetchTrackFeatures(trackId);

    // Update state
    currentTrackFeatures = nextTrackFeatures || features;
    nextTrackFeatures = features;

    // Start pre-fetch for smart queue
    if (settings.smartQueue && features) {
      setTimeout(() => smartQueueNextTrack(features), 3000);
    }

    // Schedule transition near end of track
    scheduleTransition(item, features);
  }

  function scheduleTransition(item, features) {
    if (transitionTimer) clearTimeout(transitionTimer);

    const duration = item.duration?.milliseconds || item.duration_ms || 0;
    if (!duration) return;

    const fadeDuration = calcCrossfadeDuration(currentTrackFeatures, features);
    const triggerAt = duration - fadeDuration * 1000 - 500;

    if (triggerAt <= 0) return;

    transitionTimer = setTimeout(async () => {
      const mode = resolveTransitionMode(currentTrackFeatures, features);
      showTransitionOverlay(features, mode, fadeDuration);
      await performTransition(fadeDuration, mode);
    }, triggerAt);
  }

  // ─── UI: Transition Overlay ───────────────────────────────────────────────────
  function showTransitionOverlay(features, mode, duration) {
    const existing = document.getElementById("automix-overlay");
    if (existing) existing.remove();

    const modeLabel = {
      beatmatch: "Beat Match",
      smart: "Smart Fade",
      crossfade: "Crossfade",
    }[mode] || "AutoMix";

    const bpm = features ? Math.round(features.tempo) : "--";
    const key = features ? keyName(features.key, features.mode) : "--";

    const overlay = document.createElement("div");
    overlay.id = "automix-overlay";
    overlay.innerHTML = `
      <div class="automix-pill">
        <span class="automix-icon">⟳</span>
        <span class="automix-label">${modeLabel}</span>
        <span class="automix-meta">${bpm} BPM · ${key}</span>
        <div class="automix-bar">
          <div class="automix-bar-fill" style="animation-duration: ${duration}s"></div>
        </div>
      </div>
    `;

    injectOverlayStyles();
    document.body.appendChild(overlay);

    setTimeout(() => overlay.remove(), (duration + 1) * 1000);
  }

  function injectOverlayStyles() {
    if (document.getElementById("automix-overlay-styles")) return;
    const style = document.createElement("style");
    style.id = "automix-overlay-styles";
    style.textContent = `
      #automix-overlay {
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        pointer-events: none;
        animation: automix-fadein 0.4s ease;
      }
      @keyframes automix-fadein {
        from { opacity: 0; transform: translateX(-50%) translateY(8px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      .automix-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #fff;
        font-size: 12px;
        font-family: var(--font-family, CircularSp, sans-serif);
        padding: 6px 14px 6px 10px;
        border-radius: 100px;
        border: 1px solid rgba(255,255,255,0.12);
        min-width: 220px;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
      .automix-pill > * {
        pointer-events: none;
      }
      .automix-icon {
        font-size: 13px;
        opacity: 0.7;
        display: inline-block;
        animation: automix-spin 1.5s linear infinite;
      }
      @keyframes automix-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      .automix-label {
        font-weight: 600;
        font-size: 12px;
        letter-spacing: 0.3px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .automix-meta {
        font-size: 11px;
        opacity: 0.55;
        letter-spacing: 0.2px;
      }
      .automix-bar {
        width: 100%;
        height: 2px;
        background: rgba(255,255,255,0.15);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 2px;
      }
      .automix-bar-fill {
        height: 100%;
        width: 100%;
        background: linear-gradient(90deg, #1DB954, #1ed760);
        border-radius: 2px;
        animation: automix-progress linear forwards;
        transform-origin: left;
      }
      @keyframes automix-progress {
        from { transform: scaleX(1); }
        to   { transform: scaleX(0); }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Music Theory: Key Names ───────────────────────────────────────────────────
  function keyName(key, mode) {
    const keys = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
    if (key === -1) return "?";
    return `${keys[key] || "?"}${mode === 0 ? "m" : ""}`;
  }

  // ─── Settings Panel (Spicetify PopupModal) ────────────────────────────────────
  function buildSettingsHTML() {
    return `
      <div id="automix-settings" style="
        font-family: var(--font-family, CircularSp, sans-serif);
        padding: 20px;
        color: var(--spice-text, #fff);
        min-width: 320px;
      ">
        <h2 style="margin: 0 0 18px; font-size: 18px; font-weight: 700; letter-spacing: -0.3px;">
          ⟳ AutoMix Settings
        </h2>

        <label class="am-toggle-row">
          <span class="am-label">Enable AutoMix</span>
          <input type="checkbox" id="am-enabled" ${settings.enabled ? "checked" : ""}>
        </label>

        <label class="am-toggle-row">
          <span class="am-label">Smart Queue</span>
          <small class="am-hint">Auto-add tempo-matched tracks</small>
          <input type="checkbox" id="am-smart-queue" ${settings.smartQueue ? "checked" : ""}>
        </label>

        <label class="am-toggle-row">
          <span class="am-label">Energy Blend</span>
          <small class="am-hint">Adjust fade length by energy</small>
          <input type="checkbox" id="am-energy-blend" ${settings.energyBlend ? "checked" : ""}>
        </label>

        <div class="am-row">
          <span class="am-label">Transition Mode</span>
          <select id="am-fade-mode" class="am-select">
            <option value="smart"      ${settings.fadeMode === "smart"      ? "selected" : ""}>Smart (Auto)</option>
            <option value="crossfade"  ${settings.fadeMode === "crossfade"  ? "selected" : ""}>Crossfade</option>
            <option value="beatmatch"  ${settings.fadeMode === "beatmatch"  ? "selected" : ""}>Beat Match</option>
          </select>
        </div>

        <div class="am-row">
          <span class="am-label">Crossfade Duration</span>
          <span class="am-value" id="am-cf-val">${settings.crossfadeDuration}s</span>
          <input type="range" id="am-cf-dur" min="2" max="12" step="1"
                 value="${settings.crossfadeDuration}" class="am-slider">
        </div>

        <div class="am-row">
          <span class="am-label">Beat-Match Window</span>
          <span class="am-value" id="am-bpm-val">±${settings.minBpmMatch} BPM</span>
          <input type="range" id="am-bpm-win" min="5" max="30" step="5"
                 value="${settings.minBpmMatch}" class="am-slider">
        </div>

        <button id="am-save-btn" style="
          margin-top: 20px;
          width: 100%;
          background: #1DB954;
          color: #000;
          border: none;
          border-radius: 500px;
          padding: 10px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.5px;
        ">Save Settings</button>

        <style>
          .am-toggle-row { display: flex; align-items: center; margin-bottom: 14px; gap: 8px; cursor: pointer; }
          .am-toggle-row input[type=checkbox] { margin-left: auto; width: 18px; height: 18px; accent-color: #1DB954; cursor: pointer; }
          .am-label { font-size: 13px; font-weight: 600; flex: 1; }
          .am-hint  { font-size: 11px; opacity: 0.5; }
          .am-row   { margin-bottom: 16px; }
          .am-row .am-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
          .am-value { font-size: 11px; opacity: 0.55; float: right; }
          .am-slider { width: 100%; accent-color: #1DB954; cursor: pointer; }
          .am-select {
            width: 100%; background: rgba(255,255,255,0.08);
            color: var(--spice-text, #fff); border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer;
          }
        </style>
      </div>
    `;
  }

  function openSettingsPanel() {
    const container = document.createElement("div");
    container.innerHTML = buildSettingsHTML();

    // Wire controls
    const cf = container.querySelector("#am-cf-dur");
    const cfVal = container.querySelector("#am-cf-val");
    cf.addEventListener("input", () => (cfVal.textContent = `${cf.value}s`));

    const bpmWin = container.querySelector("#am-bpm-win");
    const bpmVal = container.querySelector("#am-bpm-val");
    bpmWin.addEventListener("input", () => (bpmVal.textContent = `±${bpmWin.value} BPM`));

    container.querySelector("#am-save-btn").addEventListener("click", () => {
      settings.enabled = container.querySelector("#am-enabled").checked;
      settings.smartQueue = container.querySelector("#am-smart-queue").checked;
      settings.energyBlend = container.querySelector("#am-energy-blend").checked;
      settings.fadeMode = container.querySelector("#am-fade-mode").value;
      settings.crossfadeDuration = parseInt(cf.value);
      settings.minBpmMatch = parseInt(bpmWin.value);
      saveSettings();
      updateTopBarButton();
      Spicetify.PopupModal.hide();
      Spicetify.showNotification("AutoMix settings saved!");
    });

    Spicetify.PopupModal.display({ title: "", content: container, isLarge: false });
  }

  // ─── Top Bar Button ───────────────────────────────────────────────────────────
  function updateTopBarButton() {
    const btn = document.getElementById("automix-topbar-btn");
    if (!btn) return;
    btn.style.opacity = settings.enabled ? "1" : "0.4";
    btn.title = settings.enabled ? "AutoMix: ON — click to configure" : "AutoMix: OFF — click to configure";
  }

  function addTopBarButton() {
    const existing = document.getElementById("automix-topbar-btn");
    if (existing) return;

    const btn = document.createElement("button");
    btn.id = "automix-topbar-btn";
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        <path d="M9 9l12-2"/>
        <path d="M3 3l18 18" style="display:none" id="automix-cross"/>
      </svg>
    `;
    btn.style.cssText = `
      background: none; border: none; cursor: pointer;
      color: var(--spice-text, #fff);
      opacity: ${settings.enabled ? "1" : "0.4"};
      padding: 4px 8px;
      border-radius: 4px;
      display: flex; align-items: center;
      transition: opacity 0.2s;
    `;
    btn.title = settings.enabled ? "AutoMix: ON" : "AutoMix: OFF";
    btn.addEventListener("click", openSettingsPanel);

    // Insert into Spicetify top bar
    const topbar = document.querySelector(".main-topBar-topbarContentRight, .Root__top-bar [class*='topBarContentRight']");
    if (topbar) {
      topbar.prepend(btn);
    } else {
      // Fallback: try again shortly
      setTimeout(addTopBarButton, 1000);
    }
  }

  // ─── Spicetify Player Events ──────────────────────────────────────────────────
  function registerEvents() {
    Spicetify.Player.addEventListener("songchange", onTrackChange);
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────────
  function init() {
    if (!Spicetify || !Spicetify.Player || !Spicetify.LocalStorage) {
      setTimeout(init, 500);
      return;
    }

    loadSettings();
    initAudioContext();
    registerEvents();
    addTopBarButton();

    console.info("[AutoMix] Loaded — crossfade, beat-match, smart fade active.");
  }

  init();
})();
