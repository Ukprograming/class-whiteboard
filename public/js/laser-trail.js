// Transient, local-only ink. Never enters board data, history or exported images.
export class LaserTrail {
  constructor(board) {
    this.board = board;
    this.paths = [];
    this.active = null;
    this.endedAt = null;
    this.timer = null;
    this.frame = null;
    this.layer = null;
  }

  begin(x, y) {
    if (this.endedAt !== null && performance.now() - this.endedAt >= 1000) this.clear();
    this.cancelAnimation();
    this.endedAt = null;
    this.active = { color: this.board.laserColor, width: this.board.laserWidth, points: [{ x, y }] };
    this.paths.push(this.active);
    this.render();
  }

  move(x, y) {
    if (!this.active) return;
    const last = this.active.points.at(-1);
    if (Math.hypot(x - last.x, y - last.y) * this.board.scale < 1) return;
    this.active.points.push({ x, y });
    this.render();
  }

  end() {
    if (!this.active) return;
    this.active = null;
    this.endedAt = performance.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      const fade = () => {
        this.frame = null;
        if (performance.now() - this.endedAt >= 1600) return this.clear();
        this.render();
        this.frame = requestAnimationFrame(fade);
      };
      fade();
    }, 1000);
  }

  cancelAnimation() {
    clearTimeout(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = this.frame = null;
  }

  clear() {
    this.cancelAnimation();
    this.paths = [];
    this.active = null;
    this.endedAt = null;
    this.layer?.remove();
    this.layer = null;
  }

  render() {
    if (!this.paths.length) return;
    const { canvas, scale, offsetX, offsetY, dpr } = this.board;
    if (!this.layer) {
      this.layer = document.createElement("canvas");
      this.layer.className = "laser-trail-layer";
      this.layer.setAttribute("aria-hidden", "true");
      this.layer.style.cssText = "position:absolute;pointer-events:none;z-index:5;";
      canvas.parentElement.append(this.layer);
    }
    const layer = this.layer;
    if (layer.width !== canvas.width) layer.width = canvas.width;
    if (layer.height !== canvas.height) layer.height = canvas.height;
    layer.style.left = `${canvas.offsetLeft}px`;
    layer.style.top = `${canvas.offsetTop}px`;
    layer.style.width = canvas.style.width || `${canvas.clientWidth}px`;
    layer.style.height = canvas.style.height || `${canvas.clientHeight}px`;
    const ctx = layer.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, layer.width, layer.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr);
    ctx.globalAlpha = this.endedAt === null ? 1
      : Math.max(0, 1 - Math.max(0, performance.now() - this.endedAt - 1000) / 600);
    ctx.lineCap = ctx.lineJoin = "round";
    for (const path of this.paths) {
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = path.color;
      ctx.shadowBlur = 8 * dpr;
      ctx.lineWidth = path.width;
      ctx.beginPath();
      if (path.points.length === 1) {
        ctx.arc(path.points[0].x, path.points[0].y, path.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (const point of path.points.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }
    }
  }
}
