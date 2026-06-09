/**
 * Canvas 粒子背景系统
 * - 霓虹色粒子漂浮
 * - 粒子间连线效果
 * - 鼠标交互吸引
 */

const PARTICLE_COLORS = [
  'rgba(0, 240, 255,',   // 霓虹青
  'rgba(191, 0, 255,',   // 霓虹紫
  'rgba(0, 240, 255,',   // 霓虹青（加权更多）
];

const CONNECTION_DISTANCE = 120;
const MOUSE_ATTRACT_RADIUS = 150;
const MOUSE_ATTRACT_FORCE = 0.02;

class Particle {
  constructor(canvas) {
    this.canvas = canvas;
    this.reset();
  }

  reset() {
    this.x = Math.random() * this.canvas.width;
    this.y = Math.random() * this.canvas.height;
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 2;
    this.radius = Math.random() * 2 + 1;
    this.opacity = Math.random() * 0.3 + 0.3;
    this.colorIndex = Math.floor(Math.random() * PARTICLE_COLORS.length);
  }

  update(mouse) {
    // 鼠标吸引
    if (mouse.x !== null && mouse.y !== null) {
      const dx = mouse.x - this.x;
      const dy = mouse.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_ATTRACT_RADIUS && dist > 0) {
        this.vx += (dx / dist) * MOUSE_ATTRACT_FORCE;
        this.vy += (dy / dist) * MOUSE_ATTRACT_FORCE;
      }
    }

    // 速度衰减
    this.vx *= 0.99;
    this.vy *= 0.99;

    this.x += this.vx;
    this.y += this.vy;

    // 边界环绕
    if (this.x < -10) this.x = this.canvas.width + 10;
    if (this.x > this.canvas.width + 10) this.x = -10;
    if (this.y < -10) this.y = this.canvas.height + 10;
    if (this.y > this.canvas.height + 10) this.y = -10;
  }

  draw(ctx) {
    const color = PARTICLE_COLORS[this.colorIndex];
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = color + this.opacity + ')';
    ctx.fill();
  }
}

export class ParticleSystem {
  constructor() {
    this.canvas = document.getElementById('particles');
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.mouse = { x: null, y: null };
    this.animationId = null;
    this.isRunning = false;

    this._onResize = this._onResize.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  init() {
    this._resize();
    this._createParticles();
    this._bindEvents();
    this.start();
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _createParticles() {
    const count = window.innerWidth < 768 ? 40 : 80;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(this.canvas));
    }
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this._onResize();
    });

    this.canvas.style.pointerEvents = 'none';
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseleave', this._onMouseLeave);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _onResize() {
    this._resize();
    this._createParticles();
  }

  _onMouseMove(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  }

  _onMouseLeave() {
    this.mouse.x = null;
    this.mouse.y = null;
  }

  _onVisibilityChange() {
    if (document.hidden) {
      this.stop();
    } else {
      this.start();
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._animate();
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  _animate() {
    if (!this.isRunning) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 更新与绘制粒子
    for (const p of this.particles) {
      p.update(this.mouse);
      p.draw(this.ctx);
    }

    // 绘制连线
    this._drawConnections();

    this.animationId = requestAnimationFrame(() => this._animate());
  }

  _drawConnections() {
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_DISTANCE) {
          const opacity = (1 - dist / CONNECTION_DISTANCE) * 0.15;
          this.ctx.beginPath();
          this.ctx.moveTo(a.x, a.y);
          this.ctx.lineTo(b.x, b.y);
          this.ctx.strokeStyle = `rgba(0, 240, 255, ${opacity})`;
          this.ctx.lineWidth = 0.5;
          this.ctx.stroke();
        }
      }
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseleave', this._onMouseLeave);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }
}
