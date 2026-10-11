// Floating Avatar Widget Module
// Handles dragging, resizing, and lip-sync animation binding.
// CUSTOMIZATION: Modify DEFAULTS below to change initial widget position/size.

const DEFAULTS = {
  width: 320,
  height: 360,
  bottom: 80,
  right: 20,
};

const STORAGE_KEY = "kira.avatar.widget.v1";

export class AvatarWidget {
  constructor({ canvas, onClose = () => {} }) {
    this.canvas = canvas;
    this.onClose = onClose;
    this.isDragging = false;
    this.isResizing = false;
    this.dragOffset = { x: 0, y: 0 };
    this.resizeStart = { x: 0, y: 0, width: 0, height: 0 };
    this.widget = null;
    this.header = null;
    this.container = null;
    this.resizeHandle = null;

    this.setupWidget();
    this.loadPosition();
    this.bindDragEvents();
    this.bindResizeEvents();
  }

  setupWidget() {
    // Create the floating widget DOM
    this.widget = document.createElement("div");
    this.widget.className = "avatar-widget show";
    this.widget.id = "avatar-widget";

    // Header with title and controls
    this.header = document.createElement("div");
    this.header.className = "avatar-header";
    this.header.innerHTML = `
      <p class="avatar-title">Kira AI Assistant</p>
      <div class="avatar-controls">
        <button class="avatar-btn" id="avatar-minimize" title="Minimize">−</button>
        <button class="avatar-btn close" id="avatar-close" title="Close">✕</button>
      </div>
    `;

    // Canvas container
    this.container = document.createElement("div");
    this.container.className = "avatar-canvas-container";
    this.canvas.style.display = "block";
    this.container.appendChild(this.canvas);

    // Hint text
    const hint = document.createElement("div");
    hint.className = "avatar-hint";
    hint.id = "avatar-hint";
    hint.textContent = "Choose a local .vrm model in Settings to load your 3D avatar.";
    this.container.appendChild(hint);

    // Resize handle
    this.resizeHandle = document.createElement("div");
    this.resizeHandle.className = "avatar-resize-handle";
    this.container.appendChild(this.resizeHandle);

    // Assemble widget
    this.widget.appendChild(this.header);
    this.widget.appendChild(this.container);
    document.body.appendChild(this.widget);

    // Close button event
    document.getElementById("avatar-close").addEventListener("click", () => {
      this.hide();
      this.onClose();
    });

    this.container.hidden = false;
    this.minimizeButton = document.getElementById("avatar-minimize");
    this.minimizeButton.setAttribute("aria-expanded", "true");
    this.minimizeButton.addEventListener("click", () => this.toggleMinimize());
  }

  bindDragEvents() {
    this.header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      this.startDrag(e);
    });

    document.addEventListener("mousemove", (e) => {
      if (this.isDragging) this.drag(e);
    });

    document.addEventListener("mouseup", () => {
      if (this.isDragging) this.stopDrag();
    });

    // Touch support
    this.header.addEventListener("touchstart", (e) => {
      if (e.target.closest("button")) return;
      this.startDrag(e.touches[0]);
    });

    document.addEventListener("touchmove", (e) => {
      if (this.isDragging) this.drag(e.touches[0]);
    });

    document.addEventListener("touchend", () => {
      if (this.isDragging) this.stopDrag();
    });
  }

  bindResizeEvents() {
    this.resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.startResize(e);
    });

    document.addEventListener("mousemove", (e) => {
      if (this.isResizing) this.resize(e);
    });

    document.addEventListener("mouseup", () => {
      if (this.isResizing) this.stopResize();
    });

    // Touch support for resize
    this.resizeHandle.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.startResize(e.touches[0]);
    });

    document.addEventListener("touchmove", (e) => {
      if (this.isResizing) this.resize(e.touches[0]);
    });

    document.addEventListener("touchend", () => {
      if (this.isResizing) this.stopResize();
    });
  }

  startDrag(e) {
    this.isDragging = true;
    const rect = this.widget.getBoundingClientRect();
    this.dragOffset.x = e.clientX - rect.left;
    this.dragOffset.y = e.clientY - rect.top;
    this.widget.classList.add("dragging");
  }

  drag(e) {
    const newX = Math.max(0, Math.min(window.innerWidth - this.widget.offsetWidth, e.clientX - this.dragOffset.x));
    const newY = Math.max(0, Math.min(window.innerHeight - this.header.offsetHeight, e.clientY - this.dragOffset.y));
    this.widget.style.left = `${newX}px`;
    this.widget.style.top = `${newY}px`;
    this.widget.style.right = "auto";
    this.widget.style.bottom = "auto";
  }

  stopDrag() {
    this.isDragging = false;
    this.widget.classList.remove("dragging");
    this.savePosition();
  }

  startResize(e) {
    this.isResizing = true;
    const rect = this.widget.getBoundingClientRect();
    this.resizeStart = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
    };
  }

  resize(e) {
    const deltaX = e.clientX - this.resizeStart.x;
    const deltaY = e.clientY - this.resizeStart.y;
    const maxWidth = Math.max(240, window.innerWidth - this.widget.offsetLeft);
    const maxHeight = Math.max(280, window.innerHeight - this.widget.offsetTop);
    const newWidth = Math.max(240, Math.min(maxWidth, this.resizeStart.width + deltaX));
    const newHeight = Math.max(280, Math.min(maxHeight, this.resizeStart.height + deltaY));
    this.widget.style.width = `${newWidth}px`;
    this.widget.style.height = `${newHeight}px`;
  }

  stopResize() {
    this.isResizing = false;
    this.savePosition();
  }

  savePosition() {
    const pos = {
      width: this.widget.offsetWidth,
      height: this.widget.offsetHeight,
      left: this.widget.style.left || this.widget.style.right,
      top: this.widget.style.top || this.widget.style.bottom,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch (error) {
      console.warn("Could not save avatar widget position.", error);
    }
  }

  loadPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (saved.width) this.widget.style.width = `${saved.width}px`;
      if (saved.height) this.widget.style.height = `${saved.height}px`;
      if (saved.left) this.widget.style.left = saved.left;
      if (saved.top) this.widget.style.top = saved.top;
    } catch (error) {
      console.warn("Could not restore avatar widget position.", error);
    }
  }

  show() {
    this.widget.style.display = "flex";
  }

  hide() {
    this.widget.style.display = "none";
  }

  updateHint(text) {
    const hint = document.getElementById("avatar-hint");
    if (hint) hint.textContent = text;
  }

  setMouth(value) {
    this.widget?.classList.toggle("speaking", value > 0);
    this.widget?.style.setProperty("--mouth-open", String(Math.max(0, Math.min(1, value))));
  }

  toggleMinimize() {
    const minimized = !this.container.hidden;
    this.container.hidden = minimized;
    this.widget.classList.toggle("minimized", minimized);
    this.minimizeButton.textContent = minimized ? "+" : "−";
    this.minimizeButton.setAttribute("aria-expanded", String(!minimized));
  }
}
