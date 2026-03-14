/**
 * Virtual Light Entity — Animation Editor Panel
 *
 * A full-page panel registered in the HA sidebar for creating,
 * editing and previewing custom keyframe animations.
 */

const MAX_DURATION = 30;

class VLEAnimationEditorPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;

    // Editor state
    this._animName = "";
    this._animLoop = true;
    this._steps = [];
    this._editingIndex = -1;
    this._previewRunning = false;
    this._previewRAF = null;
    this._existingAnimations = [];
    this._selectedExisting = "";
    this._dirty = false;
    this._loaded = false;
  }

  // HA panel sets these properties
  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) {
      this._loaded = true;
      this._loadExistingAnimations();
    }
  }

  set narrow(val) {
    this._narrow = val;
  }

  set route(val) {
    this._route = val;
  }

  set panel(val) {
    this._panel = val;
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

  _canSave() {
    return this._animName.trim() !== "" && this._keyframeCount() >= 1;
  }

  // --- Service calls ---

  async _loadExistingAnimations() {
    if (!this._hass) return;
    try {
      const result = await this._hass.callWS({
        type: "virtual_light_entity/list_animations",
      });
      this._existingAnimations = result.animations || [];
    } catch (e) {
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
      await this._hass.callService("virtual_light_entity", "delete_animation", {
        name,
      });
      if (this._animName === name) this._newAnimation();
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
    for (let i = this._steps.length - 1; i > 0; i--) {
      if (
        this._steps[i].type === "transition" &&
        this._steps[i - 1].type === "transition"
      ) {
        this._steps.splice(i, 1);
      }
    }
    if (this._steps.length > 0 && this._steps[0].type === "transition") {
      this._steps.splice(0, 1);
    }
    this._dirty = true;
    if (this._editingIndex >= this._steps.length) this._editingIndex = -1;
    this._render();
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
    const timeline = [];
    let cursor = 0;

    for (const step of this._steps) {
      const dur = step.duration || 0;
      timeline.push({
        type: step.type,
        start: cursor,
        end: cursor + dur,
        data: step,
      });
      cursor += dur;
    }

    if (timeline.length === 0) return { rgb: [128, 128, 128], brightness: 128 };
    const totalDur = cursor;
    if (totalDur <= 0) return { rgb: [128, 128, 128], brightness: 128 };

    if (this._animLoop && totalDur > 0) t = t % totalDur;
    else t = Math.min(t, totalDur);

    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i];
      if (t >= seg.start && t < seg.end) {
        if (seg.type === "keyframe") {
          return { rgb: [...seg.data.rgb], brightness: seg.data.brightness };
        } else if (seg.type === "transition") {
          let prevKf = null,
            nextKf = null;
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
          if (!nextKf && this._animLoop) {
            for (const s of this._steps) {
              if (s.type === "keyframe") {
                nextKf = s;
                break;
              }
            }
          }
          if (!prevKf || !nextKf)
            return prevKf
              ? { rgb: [...prevKf.rgb], brightness: prevKf.brightness }
              : { rgb: [128, 128, 128], brightness: 128 };

          const dur = seg.end - seg.start;
          if (seg.data.style === "solid" || dur <= 0)
            return { rgb: [...nextKf.rgb], brightness: nextKf.brightness };

          let progress = (t - seg.start) / dur;
          progress = progress * progress * (3 - 2 * progress);

          return {
            rgb: [
              Math.round(prevKf.rgb[0] + (nextKf.rgb[0] - prevKf.rgb[0]) * progress),
              Math.round(prevKf.rgb[1] + (nextKf.rgb[1] - prevKf.rgb[1]) * progress),
              Math.round(prevKf.rgb[2] + (nextKf.rgb[2] - prevKf.rgb[2]) * progress),
            ],
            brightness: Math.round(
              prevKf.brightness + (nextKf.brightness - prevKf.brightness) * progress
            ),
          };
        }
      }
    }

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
    el.style.boxShadow = `0 0 ${20 + 30 * alpha}px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha * 0.7})`;

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

  _rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map((c) =>
          Math.max(0, Math.min(255, c))
            .toString(16)
            .padStart(2, "0")
        )
        .join("")
    );
  }

  _hexToRgb(hex) {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return [255, 255, 255];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  _escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  _keyframeIndexOf(stepIndex) {
    let count = 0;
    for (let i = 0; i < stepIndex; i++) {
      if (this._steps[i].type === "keyframe") count++;
    }
    return count;
  }

  // --- Render ---

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
          --editor-max-width: 900px;
        }

        .panel {
          background: var(--primary-background-color, #fafafa);
          min-height: 100vh;
        }

        /* Top app bar */
        .app-bar {
          background: var(--app-header-background-color, var(--primary-color, #03a9f4));
          color: var(--app-header-text-color, #fff);
          height: 64px;
          display: flex;
          align-items: center;
          padding: 0 16px;
          font-size: 20px;
          font-weight: 400;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .app-bar .back-btn {
          background: none;
          border: none;
          color: inherit;
          font-size: 24px;
          cursor: pointer;
          padding: 8px;
          margin-right: 8px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .app-bar .back-btn:hover {
          background: rgba(255,255,255,0.1);
        }

        .content {
          max-width: var(--editor-max-width);
          margin: 0 auto;
          padding: 24px 16px;
        }

        .card {
          background: var(--ha-card-background, var(--card-background-color, #fff));
          border-radius: var(--ha-card-border-radius, 12px);
          padding: 20px;
          margin-bottom: 16px;
          box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,0.1));
        }

        .card-title {
          font-size: 16px;
          font-weight: 500;
          margin-bottom: 16px;
          color: var(--primary-text-color, #333);
        }

        /* Top controls */
        .top-controls {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .top-controls select {
          font-size: 14px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
          min-width: 160px;
        }

        /* Buttons */
        button {
          cursor: pointer;
          border: none;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
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
        .btn-small { padding: 6px 12px; font-size: 13px; }

        /* Name / loop */
        .name-row {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 16px;
        }
        .name-row input[type="text"] {
          flex: 1;
          font-size: 16px;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .name-row label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          white-space: nowrap;
          color: var(--primary-text-color, #333);
        }
        .name-row input[type="checkbox"] {
          width: 18px;
          height: 18px;
        }

        /* Timeline */
        .timeline {
          display: flex;
          align-items: stretch;
          min-height: 56px;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--divider-color, #ddd);
          position: relative;
        }
        .timeline-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          color: var(--secondary-text-color, #999);
          font-size: 14px;
          font-style: italic;
          padding: 20px;
        }
        .tl-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 36px;
          position: relative;
          cursor: pointer;
          transition: opacity 0.15s;
          padding: 4px 2px;
          box-sizing: border-box;
        }
        .tl-block:hover { opacity: 0.85; }
        .tl-block.editing {
          outline: 3px solid var(--primary-color, #03a9f4);
          outline-offset: -3px;
          z-index: 1;
        }
        .tl-block .tl-label {
          font-size: 11px;
          font-weight: 500;
          color: inherit;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
          text-align: center;
          line-height: 1.2;
        }
        .tl-block .tl-dur {
          font-size: 10px;
          opacity: 0.8;
        }
        .tl-trans {
          min-width: 28px;
          max-width: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tl-trans .tl-label {
          font-size: 10px;
          writing-mode: vertical-rl;
          text-orientation: mixed;
          color: var(--secondary-text-color, #888);
          text-shadow: none;
        }

        .duration-bar {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--secondary-text-color, #888);
          margin-top: 6px;
        }

        /* Step list */
        .step-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          margin-bottom: 4px;
          border-radius: 8px;
          background: var(--secondary-background-color, #f5f5f5);
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .step-item:hover { background: var(--primary-background-color, #eee); }
        .step-item.editing {
          background: var(--primary-color, #03a9f4);
          color: #fff;
        }
        .step-num {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .step-num.kf { background: var(--primary-color, #03a9f4); color: #fff; }
        .step-item.editing .step-num.kf { background: #fff; color: var(--primary-color, #03a9f4); }
        .step-num.tr { background: var(--divider-color, #ddd); color: var(--primary-text-color, #333); }
        .step-info { flex: 1; }
        .color-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.5);
          flex-shrink: 0;
        }
        .delete-btn {
          background: none;
          border: none;
          color: var(--error-color, #ef5350);
          font-size: 18px;
          padding: 2px 8px;
          cursor: pointer;
          opacity: 0.5;
        }
        .delete-btn:hover { opacity: 1; }

        /* Inline editor */
        .inline-editor {
          padding: 16px;
          margin: 8px 0;
          border-radius: 10px;
          background: var(--secondary-background-color, #f5f5f5);
          border: 1px solid var(--divider-color, #ddd);
        }
        .inline-editor .field {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 10px;
        }
        .inline-editor .field:last-child { margin-bottom: 0; }
        .inline-editor label {
          font-size: 14px;
          min-width: 90px;
          color: var(--secondary-text-color, #666);
        }
        .inline-editor input[type="color"] {
          width: 44px;
          height: 36px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          padding: 0;
        }
        .inline-editor input[type="range"] { flex: 1; }
        .inline-editor input[type="number"] {
          width: 90px;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          font-size: 14px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .inline-editor select {
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          font-size: 14px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        .field-val {
          font-size: 14px;
          min-width: 36px;
          text-align: right;
          color: var(--primary-text-color, #333);
        }

        .actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
        }

        /* Preview */
        .preview-row {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .preview-light {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: #222;
          transition: background-color 0.08s, box-shadow 0.08s;
          border: 2px solid var(--divider-color, #ddd);
          flex-shrink: 0;
        }
        .preview-gradient {
          flex: 1;
          height: 36px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ddd);
          background: var(--secondary-background-color, #eee);
        }
        .preview-controls {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-top: 12px;
        }
        .preview-time {
          font-size: 13px;
          color: var(--secondary-text-color, #888);
          font-variant-numeric: tabular-nums;
        }

        /* Save bar */
        .save-bar {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .save-bar .btn-primary {
          padding: 10px 28px;
          font-size: 15px;
        }
        .dirty-badge {
          font-size: 12px;
          color: var(--warning-color, #ff9800);
          font-style: italic;
        }

        /* Toast */
        .toast {
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%) translateY(100px);
          background: var(--primary-color, #03a9f4);
          color: #fff;
          padding: 12px 24px;
          border-radius: 10px;
          font-size: 14px;
          transition: transform 0.3s;
          z-index: 999;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        .toast.show { transform: translateX(-50%) translateY(0); }
      </style>

      <div class="panel">
        <div class="app-bar">
          <button class="back-btn" id="btn-back" title="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          Animation Editor
        </div>

        <div class="content">
          <!-- Load / New -->
          <div class="card">
            <div class="card-title">Manage Animations</div>
            <div class="top-controls">
              <select id="anim-select">
                <option value="">-- Select animation --</option>
                ${this._existingAnimations
                  .map(
                    (a) =>
                      `<option value="${this._escHtml(a)}" ${a === this._selectedExisting ? "selected" : ""}>${this._escHtml(a)}</option>`
                  )
                  .join("")}
              </select>
              <button class="btn-primary btn-small" id="btn-load">Load</button>
              <button class="btn-outline btn-small" id="btn-new">New</button>
              ${
                this._selectedExisting
                  ? `<button class="btn-danger btn-small" id="btn-delete-anim">Delete</button>`
                  : ""
              }
            </div>
            <div class="name-row">
              <input type="text" id="anim-name" placeholder="Animation name"
                     value="${this._escHtml(this._animName)}" />
              <label>
                <input type="checkbox" id="anim-loop" ${this._animLoop ? "checked" : ""} />
                Loop
              </label>
            </div>
          </div>

          <!-- Timeline -->
          <div class="card">
            <div class="card-title">Timeline</div>
            <div class="timeline" id="timeline">
              ${
                this._steps.length === 0
                  ? `<div class="timeline-empty">Add a keyframe to start building your animation</div>`
                  : this._renderTimeline()
              }
            </div>
            <div class="duration-bar">
              <span>${totalDur.toFixed(1)}s total</span>
              <span>${remaining.toFixed(1)}s remaining (max ${MAX_DURATION}s)</span>
            </div>
          </div>

          <!-- Steps -->
          <div class="card">
            <div class="card-title">Steps</div>
            <div id="step-list">
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
          <div class="card">
            <div class="card-title">Preview</div>
            <div class="preview-row">
              <div class="preview-light"></div>
              <div class="preview-gradient" id="preview-gradient"></div>
            </div>
            <div class="preview-controls">
              <button class="btn-outline btn-small" id="btn-preview">
                ${this._previewRunning ? "Stop" : "Play Preview"}
              </button>
              <span class="preview-time"></span>
            </div>
          </div>

          <!-- Save -->
          <div class="card">
            <div class="save-bar">
              <button class="btn-primary" id="btn-save" ${canSave ? "" : "disabled"}>
                Save Animation
              </button>
              ${this._dirty ? `<span class="dirty-badge">Unsaved changes</span>` : ""}
            </div>
          </div>
        </div>

        <div class="toast"></div>
      </div>
    `;

    this._renderGradientPreview();
    this._bindEvents();
  }

  _renderTimeline() {
    const total = this._totalDuration();
    if (total <= 0) return "";

    return this._steps
      .map((s, i) => {
        const pct = ((s.duration || 0.2) / Math.max(total, 0.1)) * 100;
        if (s.type === "keyframe") {
          const [r, g, b] = s.rgb;
          const textColor =
            r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
          return `<div class="tl-block ${i === this._editingIndex ? "editing" : ""}"
                       data-index="${i}"
                       style="width:${Math.max(pct, 5)}%;background:rgb(${r},${g},${b});color:${textColor}">
            <span class="tl-label">KF${this._keyframeIndexOf(i) + 1}</span>
            <span class="tl-label tl-dur">${(s.duration || 0).toFixed(1)}s</span>
          </div>`;
        } else {
          const bg =
            s.style === "fade"
              ? "background:repeating-linear-gradient(90deg,var(--divider-color,#ccc) 0,var(--divider-color,#ccc) 3px,transparent 3px,transparent 6px)"
              : "background:var(--divider-color,#ccc)";
          return `<div class="tl-block tl-trans ${i === this._editingIndex ? "editing" : ""}"
                       data-index="${i}"
                       style="width:${Math.max(pct, 3)}%;${bg}">
            <span class="tl-label">${s.style === "fade" ? "~" : "|"}</span>
          </div>`;
        }
      })
      .join("");
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

    const stops = [];
    const n = 50;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * totalDur;
      const { rgb } = this._getColorAtTime(t);
      stops.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${(i / n) * 100}%`);
    }
    el.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
  }

  _bindEvents() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);

    // Back button
    const btnBack = $("#btn-back");
    if (btnBack) {
      btnBack.addEventListener("click", () => {
        history.back();
      });
    }

    // Load / New / Delete
    const selEl = $("#anim-select");
    $("#btn-load")?.addEventListener("click", () => {
      if (selEl?.value) this._loadAnimation(selEl.value);
    });
    $("#btn-new")?.addEventListener("click", () => this._newAnimation());
    $("#btn-delete-anim")?.addEventListener("click", () => {
      if (
        this._selectedExisting &&
        confirm(`Delete "${this._selectedExisting}"?`)
      ) {
        this._deleteAnimation(this._selectedExisting);
      }
    });

    // Name & loop
    $("#anim-name")?.addEventListener("input", (e) => {
      this._animName = e.target.value;
      this._dirty = true;
    });
    $("#anim-loop")?.addEventListener("change", (e) => {
      this._animLoop = e.target.checked;
      this._dirty = true;
    });

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

    // Inline editor
    if (this._editingIndex >= 0) {
      const step = this._steps[this._editingIndex];
      if (step?.type === "keyframe") {
        const colorInput = $("#edit-color");
        const briInput = $("#edit-brightness");
        const durInput = $("#edit-duration");

        colorInput?.addEventListener("input", (e) => {
          this._steps[this._editingIndex].rgb = this._hexToRgb(e.target.value);
          this._dirty = true;
          const ct = $("#edit-color-text");
          if (ct) ct.textContent = e.target.value;
          this._softUpdate();
        });
        briInput?.addEventListener("input", (e) => {
          this._steps[this._editingIndex].brightness = parseInt(e.target.value);
          this._dirty = true;
          const bv = $("#edit-brightness-val");
          if (bv) bv.textContent = e.target.value;
        });
        durInput?.addEventListener("change", (e) => {
          const val = Math.max(
            0.1,
            Math.min(
              parseFloat(e.target.value) || 0.1,
              this._remaining() + step.duration
            )
          );
          this._steps[this._editingIndex].duration = val;
          this._dirty = true;
          this._render();
        });
      } else if (step?.type === "transition") {
        $("#edit-style")?.addEventListener("change", (e) => {
          this._steps[this._editingIndex].style = e.target.value;
          if (e.target.value === "solid") {
            this._steps[this._editingIndex].duration = 0;
          } else {
            this._steps[this._editingIndex].duration = Math.min(
              1.0,
              this._remaining()
            );
          }
          this._dirty = true;
          this._render();
        });
        $("#edit-trans-dur")?.addEventListener("change", (e) => {
          const val = Math.max(
            0.1,
            Math.min(
              parseFloat(e.target.value) || 0.1,
              this._remaining() + step.duration
            )
          );
          this._steps[this._editingIndex].duration = val;
          this._dirty = true;
          this._render();
        });
      }
    }

    // Add buttons
    $("#btn-add-kf")?.addEventListener("click", () => this._addKeyframe());
    $("#btn-add-trans")?.addEventListener("click", () => this._addTransition());

    // Preview
    $("#btn-preview")?.addEventListener("click", () => {
      if (this._previewRunning) {
        this._stopPreview();
        this._render();
      } else {
        this._startPreview();
      }
    });

    // Save
    $("#btn-save")?.addEventListener("click", () => this._saveAnimation());
  }

  _softUpdate() {
    const timeline = this.shadowRoot.querySelector("#timeline");
    if (timeline && this._steps.length > 0) {
      timeline.innerHTML = this._renderTimeline();
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

customElements.define("vle-animation-editor-panel", VLEAnimationEditorPanel);
