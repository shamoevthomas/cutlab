// WebGL2 compositor. Draws evaluated layers onto a canvas at the project resolution.
// Used for the live preview and, frame by frame, for the export.
import type { Layer } from './scene';
import type { TextStyle } from '../model/schema';

export interface TexSource {
  el: TexImageSource;
  w: number; h: number;
  key: string;          // stable id; textures are reused per key
  dynamic: boolean;     // re-upload every frame (video)
  fit: 'contain' | 'natural';
}

const VS = `#version 300 es
in vec2 a_pos;
uniform vec2 u_canvas, u_size, u_center, u_flip;
uniform float u_rot;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x + 0.5, 0.5 - a_pos.y);
  vec2 p = a_pos * u_size * u_flip;
  float c = cos(u_rot), s = sin(u_rot);
  p = vec2(p.x * c + p.y * s, -p.x * s + p.y * c);   // clockwise rotation in degrees -> radians given
  p += u_center;
  gl_Position = vec4(p / (u_canvas * 0.5), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity, u_wipe;
uniform float u_bright, u_contrast, u_sat, u_expo, u_temp, u_tint, u_vig, u_high, u_shad;
uniform int u_chroma;
uniform vec3 u_key;
uniform float u_keyInt, u_keySoft;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 cbcr(vec3 c) { return vec2(-0.1146*c.r - 0.3854*c.g + 0.5*c.b, 0.5*c.r - 0.4542*c.g - 0.0458*c.b); }
void main() {
  if (u_wipe > 0.0 && v_uv.x > u_wipe) discard;
  vec4 t = texture(u_tex, v_uv);
  vec3 c = t.rgb;
  float a = t.a;
  if (u_chroma == 1) {
    float d = distance(cbcr(c), cbcr(u_key));
    float thr = 0.02 + u_keyInt * 0.25;
    float m = smoothstep(thr, thr + 0.02 + u_keySoft * 0.15, d);
    a *= m;
    // spill suppression toward the key colour
    float sp = (1.0 - m) * 0.6;
    c = mix(c, vec3(luma(c)), sp);
  }
  c *= pow(2.0, u_expo / 100.0);
  c += u_bright / 100.0 * 0.25;
  c = (c - 0.5) * (1.0 + u_contrast / 100.0) + 0.5;
  float l = luma(c);
  c += u_high / 100.0 * 0.25 * smoothstep(0.5, 1.0, l);
  c += u_shad / 100.0 * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
  c = mix(vec3(luma(c)), c, 1.0 + u_sat / 100.0);
  c.r += u_temp / 100.0 * 0.12; c.b -= u_temp / 100.0 * 0.12;
  c.g -= u_tint / 100.0 * 0.08;
  if (u_vig > 0.0) {
    float d = distance(v_uv, vec2(0.5)) * 1.414;
    c *= 1.0 - u_vig / 100.0 * smoothstep(0.35, 1.0, d);
  }
  c = clamp(c, 0.0, 1.0);
  a *= u_opacity;
  o = vec4(c * a, a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

export class Compositor {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null> = {};
  textures = new Map<string, { tex: WebGLTexture; lastUse: number; uploadedFor?: unknown }>();
  frame = 0;
  width = 1920; height = 1080;

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, preserveDrawingBuffer: true, antialias: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 indisponible');
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['u_canvas', 'u_size', 'u_center', 'u_flip', 'u_rot', 'u_tex', 'u_opacity', 'u_wipe', 'u_bright', 'u_contrast', 'u_sat', 'u_expo', 'u_temp', 'u_tint', 'u_vig', 'u_high', 'u_shad', 'u_chroma', 'u_key', 'u_keyInt', 'u_keySoft'])
      this.u[n] = gl.getUniformLocation(p, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  resize(w: number, h: number) {
    this.width = w; this.height = h;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private texture(src: TexSource) {
    const gl = this.gl;
    let t = this.textures.get(src.key);
    if (!t) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { tex, lastUse: 0 };
      this.textures.set(src.key, t);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (src.dynamic || t.uploadedFor !== src.el) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.el);
      t.uploadedFor = src.el;
    }
    t.lastUse = this.frame;
    return t.tex;
  }

  render(background: string, layers: Layer[], source: (L: Layer) => TexSource | null) {
    const gl = this.gl;
    this.frame++;
    gl.viewport(0, 0, this.width, this.height);
    const bg = parseInt(background.replace('#', ''), 16) || 0;
    gl.clearColor((bg >> 16 & 255) / 255, (bg >> 8 & 255) / 255, (bg & 255) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.enable(gl.BLEND);
    gl.uniform2f(this.u.u_canvas, this.width, this.height);
    gl.uniform1i(this.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const L of layers) {
      const src = source(L);
      if (!src || !src.w || !src.h) continue;
      this.texture(src);
      let w = src.w, h = src.h;
      if (src.fit === 'contain') {
        const s = Math.min(this.width / w, this.height / h);
        w *= s; h *= s;
      }
      gl.uniform2f(this.u.u_size, w * L.scale, h * L.scale);
      gl.uniform2f(this.u.u_center, L.x * this.width / 2, L.y * this.height / 2);
      gl.uniform2f(this.u.u_flip, L.flipH ? -1 : 1, L.flipV ? -1 : 1);
      gl.uniform1f(this.u.u_rot, (L.rotation * Math.PI) / 180);
      gl.uniform1f(this.u.u_opacity, Math.max(0, Math.min(1, L.opacity)));
      gl.uniform1f(this.u.u_wipe, L.wipe);
      const A = L.adjust;
      gl.uniform1f(this.u.u_bright, A.brightness); gl.uniform1f(this.u.u_contrast, A.contrast);
      gl.uniform1f(this.u.u_sat, A.saturation); gl.uniform1f(this.u.u_expo, A.exposure);
      gl.uniform1f(this.u.u_temp, A.temperature); gl.uniform1f(this.u.u_tint, A.tint);
      gl.uniform1f(this.u.u_vig, A.vignette); gl.uniform1f(this.u.u_high, A.highlights); gl.uniform1f(this.u.u_shad, A.shadows);
      gl.uniform1i(this.u.u_chroma, L.chroma.on ? 1 : 0);
      gl.uniform3f(this.u.u_key, ...L.chroma.color);
      gl.uniform1f(this.u.u_keyInt, L.chroma.intensity); gl.uniform1f(this.u.u_keySoft, L.chroma.shadow);
      this.blend(L.blend);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.gc();
  }

  private blend(mode: Layer['blend']) {
    const gl = this.gl;
    gl.blendEquation(gl.FUNC_ADD);
    switch (mode) {
      case 'multiply': gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'screen': gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
      case 'add': gl.blendFunc(gl.ONE, gl.ONE); break;
      case 'darken': gl.blendEquation(gl.MIN); gl.blendFunc(gl.ONE, gl.ONE); break;
      case 'lighten': gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE); break;
      default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  private gc() {
    if (this.frame % 120) return;
    for (const [k, t] of this.textures) if (this.frame - t.lastUse > 240) { this.gl.deleteTexture(t.tex); this.textures.delete(k); }
  }

  dispose() {
    for (const t of this.textures.values()) this.gl.deleteTexture(t.tex);
    this.textures.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ---------- text ----------

const textCache = new Map<string, { canvas: HTMLCanvasElement | OffscreenCanvas; w: number; h: number }>();

export function renderText(content: string, style: TextStyle, canvasH: number, canvasW: number) {
  const unit = Math.min(canvasW, canvasH) / 1080;
  const key = JSON.stringify([content, style, unit]);
  const hit = textCache.get(key);
  if (hit) return { ...hit, key };
  const size = style.size * unit;
  const font = `${style.italic ? 'italic ' : ''}${style.bold ? '700' : '400'} ${size}px "${style.font}", Inter, -apple-system, sans-serif`;
  const lines = content.split('\n');
  const measure = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d') as CanvasRenderingContext2D;
  measure.font = font;
  const lineH = size * 1.2;
  const pad = size * 0.35 + style.strokeWidth * unit;
  const textW = Math.max(1, ...lines.map(l => measure.measureText(l).width));
  const w = Math.ceil(textW + pad * 2), h = Math.ceil(lineH * lines.length + pad * 2);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  if (style.bgOpacity > 0) {
    g.globalAlpha = style.bgOpacity / 100;
    g.fillStyle = style.bgColor;
    const r = size * 0.25;
    g.beginPath(); (g as any).roundRect?.(0, 0, w, h, r) ?? g.rect(0, 0, w, h); g.fill();
    g.globalAlpha = 1;
  }
  g.font = font;
  g.textBaseline = 'middle';
  g.textAlign = style.align;
  const x = style.align === 'left' ? pad : style.align === 'right' ? w - pad : w / 2;
  lines.forEach((line, i) => {
    const y = pad + lineH * (i + 0.5);
    if (style.shadow) { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = size * 0.12; g.shadowOffsetY = size * 0.04; }
    if (style.strokeWidth > 0) {
      g.lineJoin = 'round';
      g.strokeStyle = style.strokeColor; g.lineWidth = style.strokeWidth * unit * 2;
      g.strokeText(line, x, y);
      g.shadowColor = 'transparent';
    }
    g.fillStyle = style.color;
    g.fillText(line, x, y);
    g.shadowColor = 'transparent';
  });
  const out = { canvas, w, h };
  if (textCache.size > 300) textCache.clear();
  textCache.set(key, out);
  return { ...out, key };
}
