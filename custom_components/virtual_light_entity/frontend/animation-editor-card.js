/**
 * Virtual Light Entity — Animation Editor Card
 *
 * A single-page Lovelace card for creating, editing and previewing
 * custom keyframe animations.
 */

const MAX_DURATION = 30;

class VLEAnimationEditorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};

    // Editor state
    this._animName = "";
    this._animLoop = true;
    this._steps = []; // {type:"keyframe"|"transition", ...}
    this._editingIndex = -1; // which step is being edited inline
    this._previewRunning = false;
    this._previewRAF = null;
    this._existingAnimations = [];
    this._selectedExisting = "";
    this._dirty = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._loadExistingAnimations();
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  getCardSize() {
    return 6;
  }

  // --- Data helpers ---

  _totalDuration() {
    return this._steps.reduce((sum, s) => sum + (s.duration || 0), 0);
  }

  _remaining() {
    return Math.max(0, MAX_DURATION - this._totalDuration());
  }

  _keyframeCount() {
    return this._steps.filter((s) => s.type === "keyframe").length;
  }

  _lastStepType() {
    if (this._steps.length === 0) return null;
    return this._steps[this._steps.length - 1].type;
  }

  _canAddTransition() {
    return this._lastStepType() === "keyframe" && this._remaining() > 0;
  }

  _canAddKeyframe() {
    return (
      this._lastStepType() !== "keyframe" || this._steps.length === 0
    ) && this._remaining() > 0;
  }

  _canSave() {
    return this._animName.trim() !== "" && this._keyframeCount() >= 1;
  }

  // --- Service calls ---

  async _loadExistingAnimations() {
    if (!this._hass) return;
    try {
      const result = await this._hass.callService(
        "virtual_light_entity",
        "list_animations",
        {},
        undefined,
        false,
        true
      );
    } catch (e) {
      // ignore — we'll also try via WS
    }

    // Fetch via websocket API
    try {
      const result = await this._hass.callWS({
        type: "virtual_light_entity/list_animations",
      });
      this._existingAnimations = result.animations || [];
    } catch (e) {
      // Fallback: check store data via REST
      this._existingAnimations = [];
    }
    this._render();
  }

  async _saveAnimation() {
    if (!this._hass || !this._canSave()) return;

    try {
      await this._hass.callService("virtual_light_entity", "save_animation", {
        name: this._animName.trim(),
        loop: this._animLoop,
        steps: this._steps,
      });
      this._dirty = false;
      this._showToast("Animation saved!");
      await this._loadExistingAnimations();
    } catch (e) {
      this._showToast("Error saving: " + e.message);
    }
  }

  async _deleteAnimation(name) {
    if (!this._hass) return;
    try {
      await this._hass.callService(
        "virtual_light_entity",
        "delete_animation",
        { name }
      );
      if (this._animName === name) {
        this._newAnimation();
      }
      await this._loadExistingAnimations();
      this._showToast("Animation deleted.");
    } catch (e) {
      this._showToast("Error deleting: " + e.message);
    }
  }

  async _loadAnimation(name) {
    if (!this._hass) return;
    try {
      const result = await this._hass.callWS({
        type: "virtual_light_entity/get_animation",
        name: name,
      });
      if (result.animation) {
        this._animName = name;
        this._animLoop = result.animation.loop ?? true;
        this._steps = JSON.parse(JSON.stringify(result.animation.steps || []));
        this._selectedExisting = name;
        this._editingIndex = -1;
        this._dirty = false;
        this._stopPreview();
        this._render();
      }
    } catch (e) {
      this._showToast("Error loading: " + e.message);
    }
  }

  _newAnimation() {
    this._animName = "";
    this._animLoop = true;
    this._steps = [];
    this._editingIndex = -1;
    this._selectedExisting = "";
    this._dirty = false;
    this._stopPreview();
    this._render();
  }

  // --- Step manipulation ---

  _addKeyframe() {
    if (this._remaining() <= 0) return;
    this._steps.push({
      type: "keyframe",
      rgb: [255, 255, 255],
      brightness: 255,
      duration: Math.min(1.0, this._remaining()),
    });
    this._dirty = true;
    this._editingIndex = this._steps.length - 1;
    this._render();
  }

  _addTransition() {
    if (this._remaining() <= 0) return;
    this._steps.push({
      type: "transition",
      style: "fade",
      duration: Math.min(1.0, this._remaining()),
    });
    this._dirty = true;
    this._editingIndex = this._steps.length - 1;
    this._render();
  }

  _deleteStep(index) {
    this._steps.splice(index, 1);
    // Clean up: if two transitions end up adjacent, remove the second
    for (let i = this._steps.length - 1; i > 0; i--) {
      if (
        this._steps[i].type === "transition" &&
        this._steps[i - 1].type === "transition"
      ) {
        this._steps.splice(i, 1);
      }
    }
    // If first step is a transition, remove it
    if (this._steps.length > 0 && this._steps[0].type === "transition") {
      this._steps.splice(0, 1);
    }
    this._dirty = true;
    if (this._editingIndex >= this._steps.length) {
      this._editingIndex = -1;
    }
    this._render();
  }

  _updateStep(index, field, value) {
    if (this._steps[index]) {
      this._steps[index][field] = value;
      this._dirty = true;
      this._render();
    }
  }

  // --- Preview ---

  _startPreview() {
    if (this._steps.length === 0) return;
    this._previewRunning = true;
    this._previewStartTime = performance.now();
    this._runPreviewFrame();
    this._render();
  }

  _stopPreview() {
    this._previewRunning = false;
    if (this._previewRAF) {
      cancelAnimationFrame(this._previewRAF);
      this._previewRAF = null;
    }
  }

  _runPreviewFrame() {
    if (!this._previewRunning) return;
    this._previewRAF = requestAnimationFrame(() => {
      this._updatePreviewBar();
      this._runPreviewFrame();
    });
  }

  _getColorAtTime(t) {
    // Walk through steps, accumulating time
    const keyframes = [];
    const transitions = [];
    let timeline = []; // [{type, start, end, data}]
    let cursor = 0;

    for (const step of this._steps) {
      const dur = step.duration || 0;
      if (step.type === "keyframe") {
        timeline.push({
          type: "keyframe",
          start: cursor,
          end: cursor + dur,
          data: step,
        });
        cursor += dur;
      } else if (step.type === "transition") {
        timeline.push({
          type: "transition",
          start: cursor,
          end: cursor + dur,
          data: step,
        });
        cursor += dur;
      }
    }

    if (timeline.length === 0) return { rgb: [128, 128, 128], brightness: 128 };

    const totalDur = cursor;
    if (totalDur <= 0) return { rgb: [128, 128, 128], brightness: 128 };

    // Wrap time for looping
    if (this._animLoop && totalDur > 0) {
      t = t % totalDur;
    } else {
      t = Math.min(t, totalDur);
    }

    // Find which segment we're in
    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i];
      if (t >= seg.start && t < seg.end) {
        if (seg.type === "keyframe") {
          return {
            rgb: [...seg.data.rgb],
            brightness: seg.data.brightness,
          };
        } else if (seg.type === "transition") {
          // Find prev and next keyframe
          let prevKf = null;
          let nextKf = null;
          for (let j = i - 1; j >= 0; j--) {
            if (timeline[j].type === "keyframe") {
              prevKf = timeline[j].data;
              break;
            }
          }
          for (let j = i + 1; j < timeline.length; j++) {
            if (timeline[j].type === "keyframe") {
              nextKf = timeline[j].data;
              break;
            }
          }
          // Wrap: if looping and no next, use first keyframe
          if (!nextKf && this._animLoop) {
            for (const s of this._steps) {
              if (s.type === "keyframe") {
                nextKf = s;
                break;
              }
            }
          }
          if (!prevKf || !nextKf) {
            return prevKf
              ? { rgb: [...prevKf.rgb], brightness: prevKf.brightness }
              : { rgb: [128, 128, 128], brightness: 128 };
          }

          const dur = seg.end - seg.start;
          if (seg.data.style === "solid" || dur <= 0) {
            return { rgb: [...nextKf.rgb], brightness: nextKf.brightness };
          }

          // Fade
          let progress = (t - seg.start) / dur;
          // ease in-out
          progress = progress * progress * (3 - 2 * progress);

          return {
            rgb: [
              Math.round(
                prevKf.rgb[0] + (nextKf.rgb[0] - prevKf.rgb[0]) * progress
              ),
              Math.round(
                prevKf.rgb[1] + (nextKf.rgb[1] - prevKf.rgb[1]) * progress
              ),
              Math.round(
                prevKf.rgb[2] + (nextKf.rgb[2] - prevKf.rgb[2]) * progress
              ),
            ],
            brightness: Math.round(
              prevKf.brightness +
                (nextKf.brightness - prevKf.brightness) * progress
            ),
          };
        }
      }
    }

    // Past end — return last keyframe
    const lastKf = [...this._steps].reverse().find((s) => s.type === "keyframe");
    if (lastKf) return { rgb: [...lastKf.rgb], brightness: lastKf.brightness };
    return { rgb: [128, 128, 128], brightness: 128 };
  }

  _updatePreviewBar() {
    const el = this.shadowRoot.querySelector(".preview-light");
    if (!el) return;

    const elapsed = (performance.now() - this._previewStartTime) / 1000;
    const { rgb, brightness } = this._getColorAtTime(elapsed);
    const alpha = brightness / 255;
    el.style.backgroundColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    el.style.boxShadow = `0 0 ${20 + 20 * alpha}px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha * 0.8})`;

    // Update time display
    const timeEl = this.shadowRoot.querySelector(".preview-time");
    if (timeEl) {
      const total = this._totalDuration();
      const display = this._animLoop ? elapsed % total : Math.min(elapsed, total);
      timeEl.textContent = `${display.toFixed(1)}s / ${total.toFixed(1)}s`;
    }
  }

  _showToast(msg) {
    const toast = this.shadowRoot.querySelector(".toast");
    if (toast) {
      toast.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2500);
    }
  }

  // --- Render ---

  _rgbToHex(rgb) {
    return (
      "#" +
      rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")
    );
  }

  _hexToRgb(hex) {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return [255, 255, 255];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  _render() {
    const totalDur = this._totalDuration();
    const remaining = this._remaining();
    const canAddKf =
      (this._lastStepType() !== "keyframe" || this._steps.length === 0) &&
      remaining > 0;
    const canAddTrans = this._lastStepType() === "keyframe" && remaining > 0;
    const canSave = this._canSave();

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--primary-font-family, Roboto, sans-serif);
        }
        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          padding: 16px;
          color: var(--primary-text-color, #333);
          box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,0.15));
        }
        .card-header {
          font-size: 18px;
          font-weight: 500;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section { margin-bottom: 16px; }
        .section-title {
          font-size: 13px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--secondary-text-color, #666);
          margin-bottom: 8px;
        }

        /* Top bar: load / new */
        .top-bar {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .top-bar select, .top-bar input, .top-bar button {
          font-size: 14px;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .top-bar input { flex: 1; min-width: 120px; }

        /* Buttons */
        button {
          cursor: pointer;
          border: none;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          transition: background 0.2s, opacity 0.2s;
        }
        button:disabled { opacity: 0.4; cursor: default; }
        .btn-primary {
          background: var(--primary-color, #03a9f4);
          color: #fff;
        }
        .btn-primary:hover:not(:disabled) { opacity: 0.85; }
        .btn-danger { background: #ef5350; color: #fff; }
        .btn-danger:hover:not(:disabled) { opacity: 0.85; }
        .btn-outline {
          background: transparent;
          border: 1px solid var(--divider-color, #ddd);
          color: var(--primary-text-color, #333);
        }
        .btn-outline:hover:not(:disabled) { background: var(--secondary-background-color, #f5f5f5); }
        .btn-small { padding: 4px 10px; font-size: 12px; }

        /* Name / loop row */
        .name-row {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-bottom: 12px;
        }
        .name-row input[type="text"] {
          flex: 1;
          font-size: 15px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .name-row label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          white-space: nowrap;
        }

        /* Timeline visual */
        .timeline {
          display: flex;
          align-items: stretch;
          min-height: 50px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid var(--divider-color, #ddd);
          margin-bottom: 4px;
          position: relative;
        }
        .timeline-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          color: var(--secondary-text-color, #999);
          font-size: 13px;
          font-style: italic;
          padding: 16px;
        }
        .tl-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 32px;
          position: relative;
          cursor: pointer;
          transition: opacity 0.15s;
          padding: 4px 2px;
          box-sizing: border-box;
        }
        .tl-block:hover { opacity: 0.85; }
        .tl-block.editing { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -2px; }
        .tl-block .tl-label {
          font-size: 10px;
          color: inherit;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          text-align: center;
          line-height: 1.2;
        }
        .tl-block .tl-dur {
          font-size: 9px;
          opacity: 0.8;
        }
        .tl-trans {
          min-width: 24px;
          max-width: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tl-trans .tl-label {
          font-size: 9px;
          writing-mode: vertical-rl;
          text-orientation: mixed;
          color: var(--secondary-text-color, #888);
        }

        /* Duration bar */
        .duration-bar {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--secondary-text-color, #888);
          margin-bottom: 12px;
        }

        /* Step list */
        .step-list { margin-bottom: 12px; }
        .step-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          margin-bottom: 4px;
          border-radius: 8px;
          background: var(--secondary-background-color, #f5f5f5);
          font-size: 13px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .step-item:hover { background: var(--primary-background-color, #eee); }
        .step-item.editing {
          background: var(--primary-color, #03a9f4);
          color: #fff;
        }
        .step-item .step-num {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .step-item .step-num.kf { background: var(--primary-color, #03a9f4); color: #fff; }
        .step-item.editing .step-num.kf { background: #fff; color: var(--primary-color, #03a9f4); }
        .step-item .step-num.tr { background: var(--divider-color, #ddd); color: var(--primary-text-color, #333); }
        .step-item .step-info { flex: 1; }
        .step-item .color-dot {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.5);
          flex-shrink: 0;
        }
        .step-item .delete-btn {
          background: none;
          border: none;
          color: var(--error-color, #ef5350);
          font-size: 16px;
          padding: 2px 6px;
          cursor: pointer;
          opacity: 0.6;
        }
        .step-item .delete-btn:hover { opacity: 1; }

        /* Inline editor */
        .inline-editor {
          padding: 12px;
          margin-bottom: 8px;
          border-radius: 8px;
          background: var(--secondary-background-color, #f5f5f5);
          border: 1px solid var(--divider-color, #ddd);
        }
        .inline-editor .field {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .inline-editor .field:last-child { margin-bottom: 0; }
        .inline-editor label {
          font-size: 13px;
          min-width: 80px;
          color: var(--secondary-text-color, #666);
        }
        .inline-editor input[type="color"] {
          width: 40px;
          height: 32px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          padding: 0;
        }
        .inline-editor input[type="range"] { flex: 1; }
        .inline-editor input[type="number"] {
          width: 80px;
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ddd);
          font-size: 13px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .inline-editor select {
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ddd);
          font-size: 13px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .inline-editor .field-val {
          font-size: 13px;
          min-width: 30px;
          text-align: right;
        }

        /* Action buttons row */
        .actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 12px;
        }

        /* Preview */
        .preview-section {
          margin-top: 8px;
        }
        .preview-container {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .preview-light {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: #333;
          transition: background-color 0.08s, box-shadow 0.08s;
          border: 2px solid var(--divider-color, #ddd);
          flex-shrink: 0;
        }
        .preview-gradient {
          flex: 1;
          height: 30px;
          border-radius: 6px;
          border: 1px solid var(--divider-color, #ddd);
        }
        .preview-controls {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }
        .preview-time {
          font-size: 12px;
          color: var(--secondary-text-color, #888);
          font-variant-numeric: tabular-nums;
        }

        /* Toast */
        .toast {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%) translateY(100px);
          background: var(--primary-color, #03a9f4);
          color: #fff;
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          transition: transform 0.3s;
          z-index: 999;
          pointer-events: none;
        }
        .toast.show { transform: translateX(-50%) translateY(0); }
      </style>

      <div class="card">
        <div class="card-header">Animation Editor</div>

        <!-- Load existing / New -->
        <div class="top-bar">
          <select id="anim-select">
            <option value="">-- Load animation --</option>
            ${this._existingAnimations
              .map((a) => `<option value="${a}" ${a === this._selectedExisting ? "selected" : ""}>${a}</option>`)
              .join("")}
          </select>
          <button class="btn-outline btn-small" id="btn-load">Load</button>
          <button class="btn-outline btn-small" id="btn-new">New</button>
          ${
            this._selectedExisting
              ? `<button class="btn-danger btn-small" id="btn-delete-anim">Delete</button>`
              : ""
          }
        </div>

        <!-- Name & Loop -->
        <div class="name-row">
          <input type="text" id="anim-name" placeholder="Animation name"
                 value="${this._escHtml(this._animName)}" />
          <label>
            <input type="checkbox" id="anim-loop" ${this._animLoop ? "checked" : ""} />
            Loop
          </label>
        </div>

        <!-- Visual timeline -->
        <div class="section">
          <div class="section-title">Timeline</div>
          <div class="timeline" id="timeline">
            ${this._steps.length === 0 ? `<div class="timeline-empty">Add a keyframe to start</div>` : this._renderTimeline()}
          </div>
          <div class="duration-bar">
            <span>${totalDur.toFixed(1)}s total</span>
            <span>${remaining.toFixed(1)}s remaining (max ${MAX_DURATION}s)</span>
          </div>
        </div>

        <!-- Step list with inline editing -->
        <div class="section">
          <div class="section-title">Steps</div>
          <div class="step-list" id="step-list">
            ${this._steps.map((s, i) => this._renderStepItem(s, i)).join("")}
          </div>
          ${this._editingIndex >= 0 ? this._renderInlineEditor(this._editingIndex) : ""}

          <div class="actions">
            <button class="btn-primary btn-small" id="btn-add-kf"
                    ${canAddKf ? "" : "disabled"}>+ Keyframe</button>
            <button class="btn-outline btn-small" id="btn-add-trans"
                    ${canAddTrans ? "" : "disabled"}>+ Transition</button>
          </div>
        </div>

        <!-- Preview -->
        <div class="section preview-section">
          <div class="section-title">Preview</div>
          <div class="preview-container">
            <div class="preview-light"></div>
            <div class="preview-gradient" id="preview-gradient"></div>
          </div>
          <div class="preview-controls">
            <button class="btn-outline btn-small" id="btn-preview">
              ${this._previewRunning ? "Stop" : "Play"}
            </button>
            <span class="preview-time"></span>
          </div>
        </div>

        <!-- Save -->
        <div class="actions" style="margin-top: 12px;">
          <button class="btn-primary" id="btn-save" ${canSave ? "" : "disabled"}>
            Save Animation
          </button>
        </div>

        <div class="toast"></div>
      </div>
    `;

    this._renderGradientPreview();
    this._bindEvents();
  }

  _escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  _renderTimeline() {
    const total = this._totalDuration();
    if (total <= 0) return "";

    return this._steps
      .map((s, i) => {
        const pct = ((s.duration || 0.2) / Math.max(total, 0.1)) * 100;
        if (s.type === "keyframe") {
          const [r, g, b] = s.rgb;
          const textColor = r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
          return `<div class="tl-block ${i === this._editingIndex ? "editing" : ""}"
                       data-index="${i}"
                       style="width:${Math.max(pct, 5)}%;background:rgb(${r},${g},${b});color:${textColor}">
            <span class="tl-label">KF${this._keyframeIndexOf(i) + 1}</span>
            <span class="tl-label tl-dur">${(s.duration || 0).toFixed(1)}s</span>
          </div>`;
        } else {
          const style = s.style === "fade" ? "background:repeating-linear-gradient(90deg,var(--divider-color,#ccc) 0,var(--divider-color,#ccc) 3px,transparent 3px,transparent 6px)" : "background:var(--divider-color,#ccc)";
          return `<div class="tl-block tl-trans ${i === this._editingIndex ? "editing" : ""}"
                       data-index="${i}"
                       style="width:${Math.max(pct, 3)}%;${style}">
            <span class="tl-label">${s.style === "fade" ? "~" : "|"}</span>
          </div>`;
        }
      })
      .join("");
  }

  _keyframeIndexOf(stepIndex) {
    let count = 0;
    for (let i = 0; i < stepIndex; i++) {
      if (this._steps[i].type === "keyframe") count++;
    }
    return count;
  }

  _renderStepItem(step, index) {
    const isEditing = this._editingIndex === index;

    if (step.type === "keyframe") {
      const [r, g, b] = step.rgb;
      const kfNum = this._keyframeIndexOf(index) + 1;
      return `<div class="step-item ${isEditing ? "editing" : ""}" data-index="${index}">
        <span class="step-num kf">${kfNum}</span>
        <span class="color-dot" style="background:rgb(${r},${g},${b})"></span>
        <span class="step-info">
          RGB(${r},${g},${b}) &middot; Brightness ${step.brightness} &middot; ${step.duration}s
        </span>
        <button class="delete-btn" data-delete="${index}" title="Delete">&times;</button>
      </div>`;
    } else {
      const label =
        step.style === "fade" ? `Fade (${step.duration}s)` : "Instant";
      return `<div class="step-item ${isEditing ? "editing" : ""}" data-index="${index}">
        <span class="step-num tr">&rarr;</span>
        <span class="step-info">${label}</span>
        <button class="delete-btn" data-delete="${index}" title="Delete">&times;</button>
      </div>`;
    }
  }

  _renderInlineEditor(index) {
    const step = this._steps[index];
    if (!step) return "";

    if (step.type === "keyframe") {
      const hexColor = this._rgbToHex(step.rgb);
      return `<div class="inline-editor" id="inline-editor">
        <div class="field">
          <label>Color</label>
          <input type="color" id="edit-color" value="${hexColor}" />
          <span class="field-val" id="edit-color-text">${hexColor}</span>
        </div>
        <div class="field">
          <label>Brightness</label>
          <input type="range" id="edit-brightness" min="1" max="255" value="${step.brightness}" />
          <span class="field-val" id="edit-brightness-val">${step.brightness}</span>
        </div>
        <div class="field">
          <label>Hold (sec)</label>
          <input type="number" id="edit-duration" min="0.1" max="${this._remaining() + step.duration}" step="0.1" value="${step.duration}" />
        </div>
      </div>`;
    } else {
      return `<div class="inline-editor" id="inline-editor">
        <div class="field">
          <label>Style</label>
          <select id="edit-style">
            <option value="solid" ${step.style === "solid" ? "selected" : ""}>Solid (instant)</option>
            <option value="fade" ${step.style === "fade" ? "selected" : ""}>Fade (smooth)</option>
          </select>
        </div>
        ${
          step.style === "fade"
            ? `<div class="field">
          <label>Duration</label>
          <input type="number" id="edit-trans-dur" min="0.1" max="${this._remaining() + step.duration}" step="0.1" value="${step.duration}" />
        </div>`
            : ""
        }
      </div>`;
    }
  }

  _renderGradientPreview() {
    const el = this.shadowRoot.querySelector("#preview-gradient");
    if (!el || this._steps.length === 0) return;

    const totalDur = this._totalDuration();
    if (totalDur <= 0) return;

    // Build CSS gradient from the timeline
    const stops = [];
    const numSamples = 40;
    for (let i = 0; i <= numSamples; i++) {
      const t = (i / numSamples) * totalDur;
      const { rgb } = this._getColorAtTime(t);
      const pct = (i / numSamples) * 100;
      stops.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${pct}%`);
    }
    el.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
  }

  _bindEvents() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);

    // Load existing
    const selEl = $("#anim-select");
    const btnLoad = $("#btn-load");
    const btnNew = $("#btn-new");
    const btnDeleteAnim = $("#btn-delete-anim");

    if (btnLoad) {
      btnLoad.addEventListener("click", () => {
        const val = selEl?.value;
        if (val) this._loadAnimation(val);
      });
    }
    if (btnNew) btnNew.addEventListener("click", () => this._newAnimation());
    if (btnDeleteAnim) {
      btnDeleteAnim.addEventListener("click", () => {
        if (this._selectedExisting && confirm(`Delete "${this._selectedExisting}"?`)) {
          this._deleteAnimation(this._selectedExisting);
        }
      });
    }

    // Name & loop
    const nameInput = $("#anim-name");
    const loopInput = $("#anim-loop");
    if (nameInput) {
      nameInput.addEventListener("input", (e) => {
        this._animName = e.target.value;
        this._dirty = true;
      });
    }
    if (loopInput) {
      loopInput.addEventListener("change", (e) => {
        this._animLoop = e.target.checked;
        this._dirty = true;
      });
    }

    // Timeline clicks
    this.shadowRoot.querySelectorAll(".tl-block[data-index]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.index);
        this._editingIndex = this._editingIndex === idx ? -1 : idx;
        this._render();
      });
    });

    // Step list clicks
    this.shadowRoot.querySelectorAll(".step-item[data-index]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-btn")) return;
        const idx = parseInt(el.dataset.index);
        this._editingIndex = this._editingIndex === idx ? -1 : idx;
        this._render();
      });
    });

    // Delete buttons
    this.shadowRoot.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteStep(parseInt(btn.dataset.delete));
      });
    });

    // Inline editor bindings
    if (this._editingIndex >= 0) {
      const step = this._steps[this._editingIndex];
      if (step?.type === "keyframe") {
        const colorInput = $("#edit-color");
        const briInput = $("#edit-brightness");
        const durInput = $("#edit-duration");
        const colorText = $("#edit-color-text");
        const briVal = $("#edit-brightness-val");

        if (colorInput) {
          colorInput.addEventListener("input", (e) => {
            const rgb = this._hexToRgb(e.target.value);
            this._steps[this._editingIndex].rgb = rgb;
            this._dirty = true;
            if (colorText) colorText.textContent = e.target.value;
            this._softUpdate();
          });
        }
        if (briInput) {
          briInput.addEventListener("input", (e) => {
            this._steps[this._editingIndex].brightness = parseInt(e.target.value);
            this._dirty = true;
            if (briVal) briVal.textContent = e.target.value;
          });
        }
        if (durInput) {
          durInput.addEventListener("change", (e) => {
            const val = Math.max(0.1, Math.min(parseFloat(e.target.value) || 0.1, this._remaining() + step.duration));
            this._steps[this._editingIndex].duration = val;
            this._dirty = true;
            this._render();
          });
        }
      } else if (step?.type === "transition") {
        const styleInput = $("#edit-style");
        const durInput = $("#edit-trans-dur");

        if (styleInput) {
          styleInput.addEventListener("change", (e) => {
            this._steps[this._editingIndex].style = e.target.value;
            if (e.target.value === "solid") {
              this._steps[this._editingIndex].duration = 0;
            } else {
              this._steps[this._editingIndex].duration = Math.min(1.0, this._remaining());
            }
            this._dirty = true;
            this._render();
          });
        }
        if (durInput) {
          durInput.addEventListener("change", (e) => {
            const val = Math.max(0.1, Math.min(parseFloat(e.target.value) || 0.1, this._remaining() + step.duration));
            this._steps[this._editingIndex].duration = val;
            this._dirty = true;
            this._render();
          });
        }
      }
    }

    // Add buttons
    const btnAddKf = $("#btn-add-kf");
    const btnAddTrans = $("#btn-add-trans");
    if (btnAddKf) btnAddKf.addEventListener("click", () => this._addKeyframe());
    if (btnAddTrans) btnAddTrans.addEventListener("click", () => this._addTransition());

    // Preview
    const btnPreview = $("#btn-preview");
    if (btnPreview) {
      btnPreview.addEventListener("click", () => {
        if (this._previewRunning) {
          this._stopPreview();
          this._render();
        } else {
          this._startPreview();
        }
      });
    }

    // Save
    const btnSave = $("#btn-save");
    if (btnSave) btnSave.addEventListener("click", () => this._saveAnimation());
  }

  _softUpdate() {
    // Update just the timeline and gradient without full re-render
    const timeline = this.shadowRoot.querySelector("#timeline");
    if (timeline && this._steps.length > 0) {
      timeline.innerHTML = this._renderTimeline();
      // Rebind timeline clicks
      this.shadowRoot.querySelectorAll(".tl-block[data-index]").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = parseInt(el.dataset.index);
          this._editingIndex = this._editingIndex === idx ? -1 : idx;
          this._render();
        });
      });
    }
    this._renderGradientPreview();
  }
}

customElements.define("vle-animation-editor", VLEAnimationEditorCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "vle-animation-editor",
  name: "Virtual Light Animation Editor",
  description: "Create and edit custom keyframe animations for Virtual Light entities",
});
