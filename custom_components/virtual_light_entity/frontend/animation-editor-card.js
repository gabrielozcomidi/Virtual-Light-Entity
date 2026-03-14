/**
 * Virtual Light Entity — Animation Editor Panel (v2)
 *
 * Full-page sidebar panel for creating, editing and previewing
 * custom keyframe animations with:
 *   - Step reorder (move up/down) and duplicate
 *   - Color presets palette
 *   - Easing curve selection on transitions
 *   - Undo / Redo history stack
 *   - Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+S, Delete)
 *   - Test-on-entity: push animation to a real VLE light
 *   - Animated timeline playhead during preview
 */

const MAX_DURATION = 30;

const COLOR_PRESETS = [
  { name: "Warm White",  hex: "#FFE4B5", rgb: [255, 228, 181] },
  { name: "Cool White",  hex: "#F0F8FF", rgb: [240, 248, 255] },
  { name: "Daylight",    hex: "#FFFAF0", rgb: [255, 250, 240] },
  { name: "Red",         hex: "#FF0000", rgb: [255, 0, 0] },
  { name: "Orange",      hex: "#FF8C00", rgb: [255, 140, 0] },
  { name: "Yellow",      hex: "#FFD700", rgb: [255, 215, 0] },
  { name: "Green",       hex: "#00C853", rgb: [0, 200, 83] },
  { name: "Cyan",        hex: "#00BCD4", rgb: [0, 188, 212] },
  { name: "Blue",        hex: "#2196F3", rgb: [33, 150, 243] },
  { name: "Purple",      hex: "#9C27B0", rgb: [156, 39, 176] },
  { name: "Pink",        hex: "#E91E63", rgb: [233, 30, 99] },
  { name: "Deep Red",    hex: "#8B0000", rgb: [139, 0, 0] },
];

const EASING_OPTIONS = [
  { value: "ease-in-out", label: "Ease In-Out (smooth)" },
  { value: "linear",      label: "Linear (constant)" },
  { value: "ease-in",     label: "Ease In (accelerate)" },
  { value: "ease-out",    label: "Ease Out (decelerate)" },
];

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

    // Undo/redo
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistory = 50;

    // Test on entity
    this._vleEntities = [];
    this._testEntityId = "";

    // Drag and drop
    this._dragIndex = -1;
    this._dragOverIndex = -1;

    // Keyboard handler ref
    this._keyHandler = this._handleKeyboard.bind(this);
  }

  connectedCallback() {
    document.addEventListener("keydown", this._keyHandler);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this._keyHandler);
    this._stopPreview();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) {
      this._loaded = true;
      this._loadExistingAnimations();
      this._loadVLEEntities();
    }
  }

  set narrow(v) { this._narrow = v; }
  set route(v) { this._route = v; }
  set panel(v) { this._panel = v; }

  // --- Undo / Redo ---

  _pushUndo() {
    this._undoStack.push({
      steps: JSON.parse(JSON.stringify(this._steps)),
      animName: this._animName,
      animLoop: this._animLoop,
      editingIndex: this._editingIndex,
    });
    if (this._undoStack.length > this._maxHistory) this._undoStack.shift();
    this._redoStack = [];
  }

  _undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push({
      steps: JSON.parse(JSON.stringify(this._steps)),
      animName: this._animName,
      animLoop: this._animLoop,
      editingIndex: this._editingIndex,
    });
    const prev = this._undoStack.pop();
    this._steps = prev.steps;
    this._animName = prev.animName;
    this._animLoop = prev.animLoop;
    this._editingIndex = prev.editingIndex;
    this._dirty = true;
    this._render();
  }

  _redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push({
      steps: JSON.parse(JSON.stringify(this._steps)),
      animName: this._animName,
      animLoop: this._animLoop,
      editingIndex: this._editingIndex,
    });
    const next = this._redoStack.pop();
    this._steps = next.steps;
    this._animName = next.animName;
    this._animLoop = next.animLoop;
    this._editingIndex = next.editingIndex;
    this._dirty = true;
    this._render();
  }

  // --- Keyboard shortcuts ---

  _handleKeyboard(e) {
    // Only handle when this panel is visible
    if (!this.isConnected) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === "z") {
      e.preventDefault();
      this._undo();
    } else if (ctrl && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
      e.preventDefault();
      this._redo();
    } else if (ctrl && e.key === "s") {
      e.preventDefault();
      if (this._canSave()) this._saveAnimation();
    } else if (e.key === "Delete" && this._editingIndex >= 0) {
      // Don't intercept if user is typing in an input
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "select" && tag !== "textarea") {
        e.preventDefault();
        this._deleteStep(this._editingIndex);
      }
    }
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
    return this._steps.length === 0 ? null : this._steps[this._steps.length - 1].type;
  }

  _canSave() {
    return this._animName.trim() !== "" && this._keyframeCount() >= 1;
  }

  // --- Service / WS calls ---

  async _loadExistingAnimations() {
    if (!this._hass) return;
    try {
      const r = await this._hass.callWS({ type: "virtual_light_entity/list_animations" });
      this._existingAnimations = r.animations || [];
    } catch (_) {
      this._existingAnimations = [];
    }
    this._render();
  }

  async _loadVLEEntities() {
    if (!this._hass) return;
    try {
      const r = await this._hass.callWS({ type: "virtual_light_entity/list_entities" });
      this._vleEntities = r.entities || [];
    } catch (_) {
      this._vleEntities = [];
    }
    if (this._vleEntities.length > 0 && !this._testEntityId) {
      this._testEntityId = this._vleEntities[0].entity_id;
    }
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
      this._selectedExisting = this._animName.trim();
      this._showToast("Animation saved!");
      await this._loadExistingAnimations();
    } catch (e) {
      this._showToast("Error saving: " + e.message);
    }
  }

  async _deleteAnimation(name) {
    if (!this._hass) return;
    try {
      await this._hass.callService("virtual_light_entity", "delete_animation", { name });
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
      const r = await this._hass.callWS({ type: "virtual_light_entity/get_animation", name });
      if (r.animation) {
        this._pushUndo();
        this._animName = name;
        this._animLoop = r.animation.loop ?? true;
        this._steps = JSON.parse(JSON.stringify(r.animation.steps || []));
        this._selectedExisting = name;
        this._editingIndex = -1;
        this._dirty = false;
        this._stopPreview();
        this._undoStack = [];
        this._redoStack = [];
        this._render();
      }
    } catch (e) {
      this._showToast("Error loading: " + e.message);
    }
  }

  async _testOnEntity() {
    if (!this._hass || !this._testEntityId || this._steps.length === 0) return;
    try {
      await this._hass.callWS({
        type: "virtual_light_entity/test_animation",
        entity_id: this._testEntityId,
        loop: this._animLoop,
        steps: this._steps,
      });
      const name = this._vleEntities.find((e) => e.entity_id === this._testEntityId)?.name || this._testEntityId;
      this._showToast(`Testing on ${name}`);
    } catch (e) {
      this._showToast("Error: " + e.message);
    }
  }

  async _stopTestOnEntity() {
    if (!this._hass || !this._testEntityId) return;
    try {
      await this._hass.callWS({
        type: "virtual_light_entity/stop_test",
        entity_id: this._testEntityId,
      });
      this._showToast("Test stopped");
    } catch (e) {
      this._showToast("Error: " + e.message);
    }
  }

  _newAnimation() {
    this._pushUndo();
    this._animName = "";
    this._animLoop = true;
    this._steps = [];
    this._editingIndex = -1;
    this._selectedExisting = "";
    this._dirty = false;
    this._stopPreview();
    this._undoStack = [];
    this._redoStack = [];
    this._render();
  }

  // --- Step manipulation ---

  _addKeyframe() {
    if (this._remaining() <= 0) return;
    this._pushUndo();
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
    this._pushUndo();
    this._steps.push({
      type: "transition",
      style: "fade",
      easing: "ease-in-out",
      duration: Math.min(1.0, this._remaining()),
    });
    this._dirty = true;
    this._editingIndex = this._steps.length - 1;
    this._render();
  }

  _deleteStep(index) {
    this._pushUndo();
    this._steps.splice(index, 1);
    // Clean up adjacent transitions
    for (let i = this._steps.length - 1; i > 0; i--) {
      if (this._steps[i].type === "transition" && this._steps[i - 1].type === "transition") {
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

  _duplicateStep(index) {
    const step = this._steps[index];
    if (!step || this._remaining() <= 0) return;
    this._pushUndo();
    const clone = JSON.parse(JSON.stringify(step));
    clone.duration = Math.min(clone.duration || 1.0, this._remaining());
    this._steps.splice(index + 1, 0, clone);
    this._dirty = true;
    this._editingIndex = index + 1;
    this._render();
  }

  _moveStep(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= this._steps.length) return;
    this._pushUndo();
    const [item] = this._steps.splice(index, 1);
    this._steps.splice(newIndex, 0, item);
    this._dirty = true;
    this._editingIndex = newIndex;
    this._render();
  }

  // --- Drag and drop ---

  _onDragStart(e, index) {
    this._dragIndex = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    // Add a slight delay so the dragged element gets its visual
    requestAnimationFrame(() => {
      const items = this.shadowRoot.querySelectorAll(".step-item[data-index]");
      if (items[index]) items[index].classList.add("dragging");
    });
  }

  _onDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (this._dragOverIndex !== index) {
      this._dragOverIndex = index;
      // Update drop indicators
      this.shadowRoot.querySelectorAll(".step-item[data-index]").forEach((el) => {
        el.classList.remove("drag-over-above", "drag-over-below");
      });
      const items = this.shadowRoot.querySelectorAll(".step-item[data-index]");
      if (items[index]) {
        if (index < this._dragIndex) {
          items[index].classList.add("drag-over-above");
        } else if (index > this._dragIndex) {
          items[index].classList.add("drag-over-below");
        }
      }
    }
  }

  _onDragEnd() {
    this._dragIndex = -1;
    this._dragOverIndex = -1;
    this.shadowRoot.querySelectorAll(".step-item").forEach((el) => {
      el.classList.remove("dragging", "drag-over-above", "drag-over-below");
    });
  }

  _onDrop(e, targetIndex) {
    e.preventDefault();
    const fromIndex = this._dragIndex;
    this._onDragEnd();

    if (fromIndex < 0 || fromIndex === targetIndex) return;

    this._pushUndo();
    const [item] = this._steps.splice(fromIndex, 1);
    this._steps.splice(targetIndex, 0, item);
    this._dirty = true;
    this._editingIndex = targetIndex;
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
      this._updatePreview();
      this._runPreviewFrame();
    });
  }

  _applyEasing(t, easing) {
    switch (easing) {
      case "linear": return t;
      case "ease-in": return t * t;
      case "ease-out": return t * (2 - t);
      case "ease-in-out":
      default: return t * t * (3 - 2 * t);
    }
  }

  _getColorAtTime(t) {
    const timeline = [];
    let cursor = 0;
    for (const step of this._steps) {
      const dur = step.duration || 0;
      timeline.push({ type: step.type, start: cursor, end: cursor + dur, data: step });
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
        }
        if (seg.type === "transition") {
          let prevKf = null, nextKf = null;
          for (let j = i - 1; j >= 0; j--) {
            if (timeline[j].type === "keyframe") { prevKf = timeline[j].data; break; }
          }
          for (let j = i + 1; j < timeline.length; j++) {
            if (timeline[j].type === "keyframe") { nextKf = timeline[j].data; break; }
          }
          if (!nextKf && this._animLoop) {
            for (const s of this._steps) { if (s.type === "keyframe") { nextKf = s; break; } }
          }
          if (!prevKf || !nextKf)
            return prevKf ? { rgb: [...prevKf.rgb], brightness: prevKf.brightness } : { rgb: [128, 128, 128], brightness: 128 };

          const dur = seg.end - seg.start;
          if (seg.data.style === "solid" || dur <= 0)
            return { rgb: [...nextKf.rgb], brightness: nextKf.brightness };

          let progress = (t - seg.start) / dur;
          progress = this._applyEasing(progress, seg.data.easing || "ease-in-out");

          return {
            rgb: [
              Math.round(prevKf.rgb[0] + (nextKf.rgb[0] - prevKf.rgb[0]) * progress),
              Math.round(prevKf.rgb[1] + (nextKf.rgb[1] - prevKf.rgb[1]) * progress),
              Math.round(prevKf.rgb[2] + (nextKf.rgb[2] - prevKf.rgb[2]) * progress),
            ],
            brightness: Math.round(prevKf.brightness + (nextKf.brightness - prevKf.brightness) * progress),
          };
        }
      }
    }
    const lastKf = [...this._steps].reverse().find((s) => s.type === "keyframe");
    if (lastKf) return { rgb: [...lastKf.rgb], brightness: lastKf.brightness };
    return { rgb: [128, 128, 128], brightness: 128 };
  }

  _updatePreview() {
    const el = this.shadowRoot.querySelector(".preview-light");
    if (!el) return;

    const elapsed = (performance.now() - this._previewStartTime) / 1000;
    const total = this._totalDuration();
    const { rgb, brightness } = this._getColorAtTime(elapsed);
    const alpha = brightness / 255;
    el.style.backgroundColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    el.style.boxShadow = `0 0 ${20 + 30 * alpha}px rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha * 0.7})`;

    const timeEl = this.shadowRoot.querySelector(".preview-time");
    if (timeEl && total > 0) {
      const display = this._animLoop ? elapsed % total : Math.min(elapsed, total);
      timeEl.textContent = `${display.toFixed(1)}s / ${total.toFixed(1)}s`;
    }

    // Playhead
    const playhead = this.shadowRoot.querySelector(".playhead");
    if (playhead && total > 0) {
      const pos = this._animLoop ? (elapsed % total) / total : Math.min(elapsed / total, 1);
      playhead.style.left = `${pos * 100}%`;
      playhead.style.display = "block";
    }
  }

  // --- Utility ---

  _showToast(msg) {
    const toast = this.shadowRoot.querySelector(".toast");
    if (toast) {
      toast.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2500);
    }
  }

  _rgbToHex(rgb) {
    return "#" + rgb.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
  }

  _hexToRgb(hex) {
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
  }

  _esc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  _kfIndex(stepIndex) {
    let c = 0;
    for (let i = 0; i < stepIndex; i++) if (this._steps[i].type === "keyframe") c++;
    return c;
  }

  // ============================================================
  //  RENDER
  // ============================================================

  _render() {
    const totalDur = this._totalDuration();
    const remaining = this._remaining();
    const canAddKf = (this._lastStepType() !== "keyframe" || this._steps.length === 0) && remaining > 0;
    const canAddTrans = this._lastStepType() === "keyframe" && remaining > 0;
    const canSave = this._canSave();

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <div class="panel">
        <div class="app-bar">
          <button class="back-btn" id="btn-back" title="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          <span class="app-bar-title">Animation Editor</span>
          <div class="app-bar-actions">
            <button class="bar-btn" id="btn-undo" title="Undo (Ctrl+Z)" ${this._undoStack.length === 0 ? "disabled" : ""}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
            </button>
            <button class="bar-btn" id="btn-redo" title="Redo (Ctrl+Y)" ${this._redoStack.length === 0 ? "disabled" : ""}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
            </button>
          </div>
        </div>

        <div class="content">
          <!-- Manage -->
          <div class="card">
            <div class="card-title">Manage Animations</div>
            <div class="top-controls">
              <select id="anim-select">
                <option value="">-- Select animation --</option>
                ${this._existingAnimations.map((a) => `<option value="${this._esc(a)}" ${a === this._selectedExisting ? "selected" : ""}>${this._esc(a)}</option>`).join("")}
              </select>
              <button class="btn-primary btn-small" id="btn-load">Load</button>
              <button class="btn-outline btn-small" id="btn-new">New</button>
              ${this._selectedExisting ? `<button class="btn-danger btn-small" id="btn-delete-anim">Delete</button>` : ""}
            </div>
            <div class="name-row">
              <input type="text" id="anim-name" placeholder="Animation name" value="${this._esc(this._animName)}" />
              <label><input type="checkbox" id="anim-loop" ${this._animLoop ? "checked" : ""} /> Loop</label>
            </div>
          </div>

          <!-- Timeline -->
          <div class="card">
            <div class="card-title">Timeline</div>
            <div class="timeline-wrapper">
              <div class="timeline" id="timeline">
                ${this._steps.length === 0
                  ? `<div class="timeline-empty">Add a keyframe to start building your animation</div>`
                  : this._renderTimeline()}
                <div class="playhead" style="display:none"></div>
              </div>
            </div>
            <div class="duration-bar">
              <span>${totalDur.toFixed(1)}s total</span>
              <span>${remaining.toFixed(1)}s remaining (max ${MAX_DURATION}s)</span>
            </div>
          </div>

          <!-- Steps -->
          <div class="card">
            <div class="card-title">Steps
              <span class="step-hint">(click to edit, Delete key to remove)</span>
            </div>
            <div id="step-list">
              ${this._steps.map((s, i) => this._renderStepItem(s, i)).join("")}
            </div>
            ${this._editingIndex >= 0 ? this._renderInlineEditor(this._editingIndex) : ""}
            <div class="actions">
              <button class="btn-primary btn-small" id="btn-add-kf" ${canAddKf ? "" : "disabled"}>+ Keyframe</button>
              <button class="btn-outline btn-small" id="btn-add-trans" ${canAddTrans ? "" : "disabled"}>+ Transition</button>
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
              <button class="btn-outline btn-small" id="btn-preview">${this._previewRunning ? "Stop" : "Play Preview"}</button>
              <span class="preview-time"></span>
            </div>
          </div>

          <!-- Test on Entity -->
          <div class="card">
            <div class="card-title">Test on Entity</div>
            ${this._vleEntities.length === 0
              ? `<div class="muted">No light entities found. Add a Virtual Light Entity first.</div>`
              : `<div class="test-row">
                  <select id="test-entity">
                    ${this._vleEntities.map((e) => `<option value="${this._esc(e.entity_id)}" ${e.entity_id === this._testEntityId ? "selected" : ""}>${this._esc(e.name)}</option>`).join("")}
                  </select>
                  <button class="btn-primary btn-small" id="btn-test" ${this._steps.length === 0 ? "disabled" : ""}>Send to Light</button>
                  <button class="btn-outline btn-small" id="btn-test-stop">Stop</button>
                </div>`
            }
          </div>

          <!-- Save -->
          <div class="card">
            <div class="save-bar">
              <button class="btn-primary" id="btn-save" ${canSave ? "" : "disabled"}>Save Animation</button>
              ${this._dirty ? `<span class="dirty-badge">Unsaved changes</span>` : ""}
              <span class="shortcut-hint">Ctrl+S</span>
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
    return this._steps.map((s, i) => {
      const pct = ((s.duration || 0.2) / Math.max(total, 0.1)) * 100;
      if (s.type === "keyframe") {
        const [r, g, b] = s.rgb;
        const tc = r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#000" : "#fff";
        return `<div class="tl-block ${i === this._editingIndex ? "editing" : ""}" data-index="${i}"
                     style="width:${Math.max(pct, 5)}%;background:rgb(${r},${g},${b});color:${tc}">
          <span class="tl-label">KF${this._kfIndex(i) + 1}</span>
          <span class="tl-label tl-dur">${(s.duration || 0).toFixed(1)}s</span>
        </div>`;
      } else {
        const bg = s.style === "fade"
          ? "background:repeating-linear-gradient(90deg,var(--divider-color,#ccc) 0,var(--divider-color,#ccc) 3px,transparent 3px,transparent 6px)"
          : "background:var(--divider-color,#ccc)";
        return `<div class="tl-block tl-trans ${i === this._editingIndex ? "editing" : ""}" data-index="${i}"
                     style="width:${Math.max(pct, 3)}%;${bg}">
          <span class="tl-label">${s.style === "fade" ? "~" : "|"}</span>
        </div>`;
      }
    }).join("");
  }

  _renderStepItem(step, index) {
    const ed = this._editingIndex === index;
    const canUp = index > 0;
    const canDown = index < this._steps.length - 1;
    const dragAttr = `draggable="true" data-drag-index="${index}"`;
    if (step.type === "keyframe") {
      const [r, g, b] = step.rgb;
      const kfNum = this._kfIndex(index) + 1;
      return `<div class="step-item ${ed ? "editing" : ""}" data-index="${index}" ${dragAttr}>
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="step-num kf">${kfNum}</span>
        <span class="color-dot" style="background:rgb(${r},${g},${b})"></span>
        <span class="step-info">RGB(${r},${g},${b}) · Bri ${step.brightness} · ${step.duration}s</span>
        <button class="icon-btn" data-move-up="${index}" title="Move up" ${canUp ? "" : "disabled"}>▲</button>
        <button class="icon-btn" data-move-down="${index}" title="Move down" ${canDown ? "" : "disabled"}>▼</button>
        <button class="icon-btn" data-dup="${index}" title="Duplicate">⧉</button>
        <button class="delete-btn" data-delete="${index}" title="Delete">&times;</button>
      </div>`;
    } else {
      const label = step.style === "fade"
        ? `Fade ${step.easing ? `(${step.easing})` : ""} ${step.duration}s`
        : "Instant";
      return `<div class="step-item ${ed ? "editing" : ""}" data-index="${index}" ${dragAttr}>
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="step-num tr">→</span>
        <span class="step-info">${label}</span>
        <button class="icon-btn" data-move-up="${index}" title="Move up" ${canUp ? "" : "disabled"}>▲</button>
        <button class="icon-btn" data-move-down="${index}" title="Move down" ${canDown ? "" : "disabled"}>▼</button>
        <button class="icon-btn" data-dup="${index}" title="Duplicate">⧉</button>
        <button class="delete-btn" data-delete="${index}" title="Delete">&times;</button>
      </div>`;
    }
  }

  _renderInlineEditor(index) {
    const step = this._steps[index];
    if (!step) return "";

    if (step.type === "keyframe") {
      const hex = this._rgbToHex(step.rgb);
      return `<div class="inline-editor" id="inline-editor">
        <div class="field">
          <label>Color</label>
          <input type="color" id="edit-color" value="${hex}" />
          <span class="field-val" id="edit-color-text">${hex}</span>
        </div>
        <div class="color-presets" id="color-presets">
          ${COLOR_PRESETS.map((p) => `<button class="preset-swatch" data-rgb="${p.rgb.join(",")}" title="${p.name}" style="background:${p.hex}"></button>`).join("")}
        </div>
        <div class="field">
          <label>Brightness</label>
          <input type="range" id="edit-brightness" min="1" max="255" value="${step.brightness}" />
          <span class="field-val" id="edit-brightness-val">${step.brightness}</span>
        </div>
        <div class="field">
          <label>Hold (sec)</label>
          <input type="number" id="edit-duration" min="0.1" max="${(this._remaining() + step.duration).toFixed(1)}" step="0.1" value="${step.duration}" />
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
        ${step.style === "fade" ? `
        <div class="field">
          <label>Easing</label>
          <select id="edit-easing">
            ${EASING_OPTIONS.map((o) => `<option value="${o.value}" ${(step.easing || "ease-in-out") === o.value ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Duration</label>
          <input type="number" id="edit-trans-dur" min="0.1" max="${(this._remaining() + step.duration).toFixed(1)}" step="0.1" value="${step.duration}" />
        </div>` : ""}
      </div>`;
    }
  }

  _renderGradientPreview() {
    const el = this.shadowRoot.querySelector("#preview-gradient");
    if (!el || this._steps.length === 0) return;
    const totalDur = this._totalDuration();
    if (totalDur <= 0) return;
    const stops = [];
    const n = 60;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * totalDur;
      const { rgb } = this._getColorAtTime(t);
      stops.push(`rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${(i / n) * 100}%`);
    }
    el.style.background = `linear-gradient(90deg, ${stops.join(", ")})`;
  }

  // ============================================================
  //  EVENTS
  // ============================================================

  _bindEvents() {
    const $ = (sel) => this.shadowRoot.querySelector(sel);

    // Back
    $("#btn-back")?.addEventListener("click", () => history.back());

    // Undo / Redo bar buttons
    $("#btn-undo")?.addEventListener("click", () => this._undo());
    $("#btn-redo")?.addEventListener("click", () => this._redo());

    // Load / New / Delete
    const sel = $("#anim-select");
    $("#btn-load")?.addEventListener("click", () => { if (sel?.value) this._loadAnimation(sel.value); });
    $("#btn-new")?.addEventListener("click", () => this._newAnimation());
    $("#btn-delete-anim")?.addEventListener("click", () => {
      if (this._selectedExisting && confirm(`Delete "${this._selectedExisting}"?`))
        this._deleteAnimation(this._selectedExisting);
    });

    // Name & loop
    $("#anim-name")?.addEventListener("input", (e) => { this._animName = e.target.value; this._dirty = true; });
    $("#anim-loop")?.addEventListener("change", (e) => {
      this._pushUndo();
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

    // Step list clicks + drag and drop
    this.shadowRoot.querySelectorAll(".step-item[data-index]").forEach((el) => {
      const idx = parseInt(el.dataset.index);
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-delete],[data-move-up],[data-move-down],[data-dup],.drag-handle")) return;
        this._editingIndex = this._editingIndex === idx ? -1 : idx;
        this._render();
      });
      // Drag events
      el.addEventListener("dragstart", (e) => this._onDragStart(e, idx));
      el.addEventListener("dragover", (e) => this._onDragOver(e, idx));
      el.addEventListener("dragleave", () => {
        el.classList.remove("drag-over-above", "drag-over-below");
      });
      el.addEventListener("drop", (e) => this._onDrop(e, idx));
      el.addEventListener("dragend", () => this._onDragEnd());
    });

    // Delete / Move / Duplicate buttons
    this.shadowRoot.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._deleteStep(parseInt(btn.dataset.delete)); });
    });
    this.shadowRoot.querySelectorAll("[data-move-up]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._moveStep(parseInt(btn.dataset.moveUp), -1); });
    });
    this.shadowRoot.querySelectorAll("[data-move-down]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._moveStep(parseInt(btn.dataset.moveDown), 1); });
    });
    this.shadowRoot.querySelectorAll("[data-dup]").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); this._duplicateStep(parseInt(btn.dataset.dup)); });
    });

    // Inline editor
    if (this._editingIndex >= 0) {
      const step = this._steps[this._editingIndex];
      if (step?.type === "keyframe") {
        $("#edit-color")?.addEventListener("input", (e) => {
          this._steps[this._editingIndex].rgb = this._hexToRgb(e.target.value);
          this._dirty = true;
          const ct = $("#edit-color-text");
          if (ct) ct.textContent = e.target.value;
          this._softUpdate();
        });
        $("#edit-color")?.addEventListener("change", () => this._pushUndo());

        // Color presets
        this.shadowRoot.querySelectorAll(".preset-swatch[data-rgb]").forEach((sw) => {
          sw.addEventListener("click", () => {
            this._pushUndo();
            const rgb = sw.dataset.rgb.split(",").map(Number);
            this._steps[this._editingIndex].rgb = rgb;
            this._dirty = true;
            this._render();
          });
        });

        $("#edit-brightness")?.addEventListener("input", (e) => {
          this._steps[this._editingIndex].brightness = parseInt(e.target.value);
          this._dirty = true;
          const bv = $("#edit-brightness-val");
          if (bv) bv.textContent = e.target.value;
        });
        $("#edit-brightness")?.addEventListener("change", () => this._pushUndo());

        $("#edit-duration")?.addEventListener("change", (e) => {
          this._pushUndo();
          const val = Math.max(0.1, Math.min(parseFloat(e.target.value) || 0.1, this._remaining() + step.duration));
          this._steps[this._editingIndex].duration = val;
          this._dirty = true;
          this._render();
        });
      } else if (step?.type === "transition") {
        $("#edit-style")?.addEventListener("change", (e) => {
          this._pushUndo();
          this._steps[this._editingIndex].style = e.target.value;
          if (e.target.value === "solid") {
            this._steps[this._editingIndex].duration = 0;
          } else {
            this._steps[this._editingIndex].duration = Math.min(1.0, this._remaining());
            this._steps[this._editingIndex].easing = this._steps[this._editingIndex].easing || "ease-in-out";
          }
          this._dirty = true;
          this._render();
        });
        $("#edit-easing")?.addEventListener("change", (e) => {
          this._pushUndo();
          this._steps[this._editingIndex].easing = e.target.value;
          this._dirty = true;
        });
        $("#edit-trans-dur")?.addEventListener("change", (e) => {
          this._pushUndo();
          const val = Math.max(0.1, Math.min(parseFloat(e.target.value) || 0.1, this._remaining() + step.duration));
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
      if (this._previewRunning) { this._stopPreview(); this._render(); }
      else this._startPreview();
    });

    // Test on entity
    $("#test-entity")?.addEventListener("change", (e) => { this._testEntityId = e.target.value; });
    $("#btn-test")?.addEventListener("click", () => this._testOnEntity());
    $("#btn-test-stop")?.addEventListener("click", () => this._stopTestOnEntity());

    // Save
    $("#btn-save")?.addEventListener("click", () => this._saveAnimation());
  }

  _softUpdate() {
    const timeline = this.shadowRoot.querySelector("#timeline");
    if (timeline && this._steps.length > 0) {
      // Keep playhead
      const playhead = timeline.querySelector(".playhead");
      timeline.innerHTML = this._renderTimeline() + '<div class="playhead" style="display:none"></div>';
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

  // ============================================================
  //  CSS
  // ============================================================

  _css() {
    return `
      :host {
        display: block;
        font-family: var(--primary-font-family, Roboto, sans-serif);
        --editor-max-width: 900px;
      }
      .panel {
        background: var(--primary-background-color, #fafafa);
        min-height: 100vh;
      }

      /* App bar */
      .app-bar {
        background: var(--app-header-background-color, var(--primary-color, #03a9f4));
        color: var(--app-header-text-color, #fff);
        height: 64px;
        display: flex;
        align-items: center;
        padding: 0 16px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      .app-bar .back-btn {
        background: none; border: none; color: inherit; font-size: 24px;
        cursor: pointer; padding: 8px; margin-right: 8px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
      }
      .app-bar .back-btn:hover { background: rgba(255,255,255,0.1); }
      .app-bar-title { font-size: 20px; font-weight: 400; flex: 1; }
      .app-bar-actions { display: flex; gap: 4px; }
      .bar-btn {
        background: none; border: none; color: inherit;
        padding: 8px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        opacity: 0.9;
      }
      .bar-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); opacity: 1; }
      .bar-btn:disabled { opacity: 0.3; cursor: default; }

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
        font-size: 16px; font-weight: 500; margin-bottom: 16px;
        color: var(--primary-text-color, #333);
        display: flex; align-items: baseline; gap: 8px;
      }
      .step-hint {
        font-size: 12px; font-weight: 400;
        color: var(--secondary-text-color, #888);
      }

      /* Controls */
      .top-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .top-controls select, .test-row select {
        font-size: 14px; padding: 8px 12px; border-radius: 8px;
        border: 1px solid var(--divider-color, #ddd);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #333);
        min-width: 160px;
      }
      .name-row {
        display: flex; gap: 12px; align-items: center; margin-top: 16px;
      }
      .name-row input[type="text"] {
        flex: 1; font-size: 16px; padding: 10px 14px; border-radius: 8px;
        border: 1px solid var(--divider-color, #ddd);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #333);
      }
      .name-row label {
        display: flex; align-items: center; gap: 6px; font-size: 14px;
        white-space: nowrap; color: var(--primary-text-color, #333);
      }
      .name-row input[type="checkbox"] { width: 18px; height: 18px; }

      /* Buttons */
      button { cursor: pointer; border: none; padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; transition: background 0.2s, opacity 0.2s; }
      button:disabled { opacity: 0.4; cursor: default; }
      .btn-primary { background: var(--primary-color, #03a9f4); color: #fff; }
      .btn-primary:hover:not(:disabled) { opacity: 0.85; }
      .btn-danger { background: #ef5350; color: #fff; }
      .btn-danger:hover:not(:disabled) { opacity: 0.85; }
      .btn-outline { background: transparent; border: 1px solid var(--divider-color, #ddd); color: var(--primary-text-color, #333); }
      .btn-outline:hover:not(:disabled) { background: var(--secondary-background-color, #f5f5f5); }
      .btn-small { padding: 6px 12px; font-size: 13px; }

      /* Timeline */
      .timeline-wrapper { position: relative; }
      .timeline {
        display: flex; align-items: stretch; min-height: 56px; border-radius: 10px;
        overflow: hidden; border: 1px solid var(--divider-color, #ddd); position: relative;
      }
      .timeline-empty {
        display: flex; align-items: center; justify-content: center; width: 100%;
        color: var(--secondary-text-color, #999); font-size: 14px; font-style: italic; padding: 20px;
      }
      .tl-block {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        min-width: 36px; position: relative; cursor: pointer; transition: opacity 0.15s;
        padding: 4px 2px; box-sizing: border-box;
      }
      .tl-block:hover { opacity: 0.85; }
      .tl-block.editing { outline: 3px solid var(--primary-color, #03a9f4); outline-offset: -3px; z-index: 1; }
      .tl-block .tl-label { font-size: 11px; font-weight: 500; color: inherit; text-shadow: 0 1px 2px rgba(0,0,0,0.5); text-align: center; line-height: 1.2; }
      .tl-block .tl-dur { font-size: 10px; opacity: 0.8; }
      .tl-trans { min-width: 28px; max-width: 60px; display: flex; align-items: center; justify-content: center; }
      .tl-trans .tl-label { font-size: 10px; writing-mode: vertical-rl; text-orientation: mixed; color: var(--secondary-text-color, #888); text-shadow: none; }

      /* Playhead */
      .playhead {
        position: absolute; top: 0; bottom: 0; width: 2px;
        background: #fff; z-index: 5; pointer-events: none;
        box-shadow: 0 0 6px rgba(0,0,0,0.5); transition: left 0.06s linear;
      }
      .playhead::after {
        content: ""; position: absolute; top: -4px; left: -4px;
        width: 10px; height: 10px; border-radius: 50%; background: #fff;
        box-shadow: 0 0 4px rgba(0,0,0,0.4);
      }

      .duration-bar { display: flex; justify-content: space-between; font-size: 12px; color: var(--secondary-text-color, #888); margin-top: 6px; }

      /* Step list */
      .step-item {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 4px;
        border-radius: 8px; background: var(--secondary-background-color, #f5f5f5);
        font-size: 14px; cursor: pointer; transition: background 0.15s;
      }
      .step-item:hover { background: var(--primary-background-color, #eee); }
      .step-item.editing { background: var(--primary-color, #03a9f4); color: #fff; }
      .step-item.dragging { opacity: 0.4; }
      .step-item.drag-over-above { border-top: 3px solid var(--primary-color, #03a9f4); margin-top: -3px; }
      .step-item.drag-over-below { border-bottom: 3px solid var(--primary-color, #03a9f4); margin-bottom: -3px; }
      .drag-handle {
        cursor: grab; font-size: 16px; opacity: 0.35; user-select: none;
        padding: 0 4px; flex-shrink: 0; line-height: 1;
      }
      .drag-handle:hover { opacity: 0.7; }
      .step-item.editing .drag-handle { opacity: 0.6; }
      .step-num {
        width: 24px; height: 24px; border-radius: 50%; display: flex;
        align-items: center; justify-content: center; font-size: 12px;
        font-weight: 600; flex-shrink: 0;
      }
      .step-num.kf { background: var(--primary-color, #03a9f4); color: #fff; }
      .step-item.editing .step-num.kf { background: #fff; color: var(--primary-color, #03a9f4); }
      .step-num.tr { background: var(--divider-color, #ddd); color: var(--primary-text-color, #333); }
      .step-info { flex: 1; font-size: 13px; }
      .color-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); flex-shrink: 0; }

      .icon-btn {
        background: none; border: none; padding: 2px 5px; font-size: 12px;
        cursor: pointer; opacity: 0.5; color: inherit; border-radius: 4px;
      }
      .icon-btn:hover:not(:disabled) { opacity: 1; background: rgba(0,0,0,0.08); }
      .icon-btn:disabled { opacity: 0.2; cursor: default; }
      .step-item.editing .icon-btn { color: #fff; }
      .step-item.editing .icon-btn:hover:not(:disabled) { background: rgba(255,255,255,0.2); }

      .delete-btn {
        background: none; border: none; color: var(--error-color, #ef5350);
        font-size: 18px; padding: 2px 6px; cursor: pointer; opacity: 0.5;
      }
      .delete-btn:hover { opacity: 1; }
      .step-item.editing .delete-btn { color: #fff; }

      /* Inline editor */
      .inline-editor {
        padding: 16px; margin: 8px 0; border-radius: 10px;
        background: var(--secondary-background-color, #f5f5f5);
        border: 1px solid var(--divider-color, #ddd);
      }
      .inline-editor .field {
        display: flex; align-items: center; gap: 12px; margin-bottom: 10px;
      }
      .inline-editor .field:last-child { margin-bottom: 0; }
      .inline-editor label { font-size: 14px; min-width: 90px; color: var(--secondary-text-color, #666); }
      .inline-editor input[type="color"] { width: 44px; height: 36px; border: none; border-radius: 8px; cursor: pointer; padding: 0; }
      .inline-editor input[type="range"] { flex: 1; }
      .inline-editor input[type="number"] {
        width: 90px; padding: 6px 10px; border-radius: 8px;
        border: 1px solid var(--divider-color, #ddd); font-size: 14px;
        background: var(--card-background-color, #fff); color: var(--primary-text-color, #333);
      }
      .inline-editor select {
        padding: 6px 10px; border-radius: 8px; border: 1px solid var(--divider-color, #ddd);
        font-size: 14px; background: var(--card-background-color, #fff); color: var(--primary-text-color, #333);
      }
      .field-val { font-size: 14px; min-width: 36px; text-align: right; color: var(--primary-text-color, #333); }

      /* Color presets */
      .color-presets {
        display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; padding: 0 0 0 102px;
      }
      .preset-swatch {
        width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--divider-color, #ddd);
        cursor: pointer; padding: 0; transition: transform 0.15s, box-shadow 0.15s;
      }
      .preset-swatch:hover { transform: scale(1.2); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }

      .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

      /* Preview */
      .preview-row { display: flex; align-items: center; gap: 16px; }
      .preview-light {
        width: 80px; height: 80px; border-radius: 50%; background: #222;
        transition: background-color 0.08s, box-shadow 0.08s;
        border: 2px solid var(--divider-color, #ddd); flex-shrink: 0;
      }
      .preview-gradient {
        flex: 1; height: 36px; border-radius: 8px;
        border: 1px solid var(--divider-color, #ddd);
        background: var(--secondary-background-color, #eee);
      }
      .preview-controls { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
      .preview-time { font-size: 13px; color: var(--secondary-text-color, #888); font-variant-numeric: tabular-nums; }

      /* Test on entity */
      .test-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .muted { font-size: 14px; color: var(--secondary-text-color, #888); font-style: italic; }

      /* Save */
      .save-bar { display: flex; gap: 10px; align-items: center; }
      .save-bar .btn-primary { padding: 10px 28px; font-size: 15px; }
      .dirty-badge { font-size: 12px; color: var(--warning-color, #ff9800); font-style: italic; }
      .shortcut-hint { font-size: 11px; color: var(--secondary-text-color, #aaa); margin-left: auto; }

      /* Toast */
      .toast {
        position: fixed; bottom: 24px; left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: var(--primary-color, #03a9f4); color: #fff;
        padding: 12px 24px; border-radius: 10px; font-size: 14px;
        transition: transform 0.3s; z-index: 999; pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      .toast.show { transform: translateX(-50%) translateY(0); }
    `;
  }
}

customElements.define("vle-animation-editor-panel", VLEAnimationEditorPanel);
