// Live preview: keeps one media element per visible clip in sync with the playhead,
// mixes audio through Web Audio, and draws every frame with the compositor.
import { useStore } from '../store';
import type { Asset, Clip, Project } from '../model/schema';
import { clipEnd, projectDuration, sourceTimeAt, valueAt } from '../model/ops';
import { Compositor, renderText, TexSource } from './compositor';
import { evaluate, Layer, audioClips } from './scene';
import { loadImage } from './media';

const DRIFT_S = 0.15;
const PRELOAD_US = 1_500_000;

interface MediaEl { el: HTMLMediaElement; gain?: GainNode; lastUse: number; assetId: string }

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

export class Player {
  comp: Compositor;
  els = new Map<string, MediaEl>();             // by clip id
  images = new Map<string, HTMLImageElement>(); // by asset id
  imageLoading = new Set<string>();
  missing = new Set<string>();                  // asset ids whose file is gone
  actx: AudioContext | null = null;
  raf = 0;
  needsRender = true;
  playStartWall = 0;
  playStartUs = 0;
  unsub: () => void;
  onMissing?: (ids: Set<string>) => void;

  constructor(public canvas: HTMLCanvasElement) {
    this.comp = new Compositor(canvas);
    this.unsub = useStore.subscribe((s, prev) => {
      if (s.project !== prev.project || s.playheadUs !== prev.playheadUs) this.needsRender = true;
      if (s.playing !== prev.playing) s.playing ? this.startPlayback() : this.stopPlayback();
    });
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    for (const m of this.els.values()) { m.el.pause(); m.el.removeAttribute('src'); m.el.load(); }
    this.els.clear();
    this.comp.dispose();
    this.actx?.close();
  }

  private ensureAudio() {
    if (!this.actx) this.actx = new AudioContext({ sampleRate: 48000 });
    if (this.actx.state === 'suspended') this.actx.resume();
  }

  private startPlayback() {
    this.ensureAudio();
    const s = useStore.getState();
    if (!s.project) return;
    if (s.playheadUs >= projectDuration(s.project) - 1000) useStore.getState().seek(0);
    this.playStartWall = performance.now();
    this.playStartUs = useStore.getState().playheadUs;
  }

  private stopPlayback() {
    for (const m of this.els.values()) m.el.pause();
    this.needsRender = true;
  }

  private element(p: Project, clip: Clip, asset: Asset, key = clip.id): HTMLMediaElement {
    let m = this.els.get(key);
    if (!m || m.assetId !== asset.id) {
      if (m) { m.el.pause(); m.el.removeAttribute('src'); }
      const el = asset.kind === 'audio' ? document.createElement('audio') : document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      (el as HTMLVideoElement).playsInline = true;
      el.src = asset.url;
      el.addEventListener('seeked', () => { this.needsRender = true; });
      el.addEventListener('loadeddata', () => { this.needsRender = true; });
      el.addEventListener('error', () => { this.missing.add(asset.id); this.onMissing?.(this.missing); });
      if ('requestVideoFrameCallback' in el) {
        const v = el as HTMLVideoElement;
        const tick = () => { this.needsRender = true; if (this.els.get(key)?.el === v) v.requestVideoFrameCallback(tick); };
        v.requestVideoFrameCallback(tick);
      }
      m = { el, lastUse: performance.now(), assetId: asset.id };
      this.els.set(key, m);
    }
    m.lastUse = performance.now();
    return m.el;
  }

  private connectGain(m: MediaEl) {
    if (m.gain || !this.actx) return;
    try {
      const src = this.actx.createMediaElementSource(m.el);
      m.gain = this.actx.createGain();
      src.connect(m.gain).connect(this.actx.destination);
    } catch { /* already connected */ }
  }

  /** Sync every media element with time t. */
  private syncMedia(p: Project, t: number, playing: boolean) {
    const active = new Set<string>();
    const audible = new Map<string, number>();
    for (const a of audioClips(p)) {
      const c = a.clip;
      if (t >= c.startUs && t < clipEnd(c)) {
        const rel = t - c.startUs;
        let db = valueAt(c, 'volumeDb', rel);
        let g = dbToGain(db);
        if (c.fadeInUs && rel < c.fadeInUs) g *= rel / c.fadeInUs;
        if (c.fadeOutUs && clipEnd(c) - t < c.fadeOutUs) g *= (clipEnd(c) - t) / c.fadeOutUs;
        audible.set(c.id, a.muted ? 0 : g);
      }
    }
    for (const track of p.tracks) {
      for (const c of track.clips) {
        if (!c.assetId || !c.enabled) continue;
        const asset = p.assets.find(a => a.id === c.assetId);
        if (!asset || asset.kind === 'image' || asset.kind === 'sticker') continue;
        const visibleSoon = t >= c.startUs - PRELOAD_US && t < clipEnd(c);
        if (!visibleSoon) continue;
        if (track.kind !== 'audio' && track.hidden && !audible.has(c.id)) continue;
        active.add(c.id);
        const matte = c.effects.find(e => e.kind === 'matte' && e.enabled);
        const mAsset = matte && p.assets.find(a => a.id === matte.params.maskAssetId);
        if (mAsset) {
          const key = c.id + ':matte';
          active.add(key);
          const me = this.element(p, c, mAsset, key);
          me.muted = true;
          const mt = (sourceTimeAt(c, Math.max(t, c.startUs)) - Number(matte!.params.maskStartUs ?? 0)) / 1e6;
          const inside0 = t >= c.startUs && t < clipEnd(c);
          if (playing && inside0 && !c.reverse) {
            me.playbackRate = Math.min(16, Math.max(0.0625, c.speed));
            if (Math.abs(me.currentTime - mt) > DRIFT_S * Math.max(1, c.speed)) me.currentTime = mt;
            if (me.paused) me.play().catch(() => {});
          } else {
            if (!me.paused) me.pause();
            if (me.readyState >= 1 && Math.abs(me.currentTime - mt) > 0.5 / p.fps) me.currentTime = mt;
          }
        }
        const el = this.element(p, c, asset);
        const m = this.els.get(c.id)!;
        const inside = t >= c.startUs && t < clipEnd(c);
        const target = sourceTimeAt(c, Math.max(t, c.startUs)) / 1e6;
        const gain = audible.get(c.id) ?? 0;
        if (playing && inside && !c.reverse) {
          this.connectGain(m);
          if (m.gain) { m.gain.gain.value = gain; el.muted = false; el.volume = 1; }
          else { el.muted = gain === 0; el.volume = Math.min(1, gain); }
          el.playbackRate = Math.min(16, Math.max(0.0625, c.speed));
          (el as any).preservesPitch = true;
          if (Math.abs(el.currentTime - target) > DRIFT_S * Math.max(1, c.speed)) el.currentTime = target;
          if (el.paused) el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (el.readyState >= 1 && Math.abs(el.currentTime - target) > 0.5 / p.fps) el.currentTime = target;
        }
      }
    }
    // pause and drop elements no longer needed
    const now = performance.now();
    for (const [id, m] of this.els) {
      if (active.has(id)) continue;
      if (!m.el.paused) m.el.pause();
      if (now - m.lastUse > 10_000) { m.el.removeAttribute('src'); m.el.load(); this.els.delete(id); }
    }
  }

  source = (L: Layer): TexSource | null => {
    const p = useStore.getState().project!;
    if (L.kind === 'text' && L.clip.text) {
      const content = L.textChars !== undefined ? L.clip.text.content.slice(0, L.textChars) : L.clip.text.content;
      if (!content) return null;
      const r = renderText(content, L.clip.text.style, p.canvas.height, p.canvas.width);
      return { el: r.canvas as TexImageSource, w: r.w, h: r.h, key: 'txt:' + r.key, dynamic: false, fit: 'natural' };
    }
    const asset = p.assets.find(a => a.id === L.assetId);
    if (!asset) return null;
    if (L.kind === 'video') {
      const m = this.els.get(L.clip.id);
      const v = m?.el as HTMLVideoElement | undefined;
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      return { el: v, w: v.videoWidth, h: v.videoHeight, key: 'v:' + L.clip.id, dynamic: true, fit: 'contain' };
    }
    const img = this.images.get(asset.id);
    if (!img) {
      if (!this.imageLoading.has(asset.id)) {
        this.imageLoading.add(asset.id);
        loadImage(asset.url).then(i => { this.images.set(asset.id, i); this.needsRender = true; })
          .catch(() => { this.missing.add(asset.id); this.onMissing?.(this.missing); });
      }
      return null;
    }
    return { el: img, w: img.naturalWidth, h: img.naturalHeight, key: 'img:' + asset.id, dynamic: false, fit: asset.kind === 'sticker' ? 'natural' : 'contain' };
  };

  maskSource = (L: Layer): TexSource | null => {
    const m = this.els.get(L.clip.id + ':matte');
    const v = m?.el as HTMLVideoElement | undefined;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    return { el: v, w: v.videoWidth, h: v.videoHeight, key: 'm:' + L.clip.id, dynamic: true, fit: 'contain' };
  };

  private loop() {
    this.raf = requestAnimationFrame(this.loop);
    const s = useStore.getState();
    const p = s.project;
    if (!p) return;
    let t = s.playheadUs;
    if (s.playing) {
      const end = s.outUs ?? projectDuration(p);
      t = this.playStartUs + (performance.now() - this.playStartWall) * 1000;
      if (t >= end) { t = end; useStore.setState({ playing: false, playheadUs: Math.max(0, end - 1) }); }
      else useStore.setState({ playheadUs: Math.round(t) });
      this.needsRender = true;
    }
    this.comp.resize(p.canvas.width, p.canvas.height);
    this.syncMedia(p, t, s.playing);
    if (!this.needsRender) return;
    this.needsRender = false;
    this.comp.render(p.canvas.background, evaluate(p, t), this.source, this.maskSource);
  }

  /** JPEG of the current frame (project cover). */
  snapshot(maxW = 480): string {
    const c = document.createElement('canvas');
    const r = Math.min(1, maxW / this.canvas.width);
    c.width = Math.round(this.canvas.width * r); c.height = Math.round(this.canvas.height * r);
    c.getContext('2d')!.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }
}
