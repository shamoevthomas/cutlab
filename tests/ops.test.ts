import { describe, it, expect } from 'vitest';
import { newProject, Asset, uid } from '../src/model/schema';
import * as op from '../src/model/ops';

const vid = (dur = 10_000_000, name = 'a.mov'): Asset => ({ id: uid(), kind: 'video', name, path: name, url: name, width: 1920, height: 1080, durationUs: dur, hasAudio: true });
const img = (): Asset => ({ id: uid(), kind: 'image', name: 'i.png', path: 'i.png', url: 'i.png', width: 100, height: 100, hasAudio: false });
const aud = (): Asset => ({ id: uid(), kind: 'audio', name: 'm.mp3', path: 'm.mp3', url: 'm.mp3', durationUs: 30_000_000, hasAudio: true });

function setup(...assets: Asset[]) { const p = newProject('t'); p.assets.push(...assets); return p; }
const main = (p: any) => op.mainTrack(p);

function invariants(p: any) {
  for (const t of p.tracks) {
    for (let i = 1; i < t.clips.length; i++) expect(t.clips[i].startUs).toBeGreaterThanOrEqual(op.clipEnd(t.clips[i - 1]));
    if (t.isMain && t.clips.length) {
      expect(t.clips[0].startUs).toBe(0);
      for (let i = 1; i < t.clips.length; i++) expect(t.clips[i].startUs).toBe(op.clipEnd(t.clips[i - 1]));
    }
  }
}

describe('adding clips', () => {
  it('first video goes on the main track at 0 with its full duration', () => {
    const a = vid(); const p = setup(a);
    const c = op.addAssetClip(p, a, 5_000_000);
    expect(main(p).clips).toHaveLength(1);
    expect(c.startUs).toBe(0); expect(c.durationUs).toBe(10_000_000);
    invariants(p);
  });
  it('magnet inserts at the nearest cut and ripples', () => {
    const a = vid(), b = vid(4_000_000, 'b'), c = vid(2_000_000, 'c'); const p = setup(a, b, c);
    op.addAssetClip(p, a, 0); op.addAssetClip(p, b, 99e9);
    op.addAssetClip(p, c, 1_000_000); // before middle of first clip -> goes first
    expect(main(p).clips.map((x: any) => x.label)).toEqual(['c', 'a.mov', 'b']);
    expect(op.projectDuration(p)).toBe(16_000_000);
    invariants(p);
  });
  it('audio goes on its own track, images default to 3 s', () => {
    const a = aud(), i = img(); const p = setup(a, i);
    const ca = op.addAssetClip(p, a, 2_000_000);
    expect(op.findClip(p, ca.id)!.track.kind).toBe('audio');
    expect(ca.startUs).toBe(2_000_000);
    const ci = op.addAssetClip(p, i, 0);
    expect(ci.durationUs).toBe(3_000_000);
  });
  it('overlay video goes to a new track when magnet off', () => {
    const a = vid(), b = vid(); const p = setup(a, b);
    op.addAssetClip(p, a, 0);
    const c = op.addAssetClip(p, b, 2_000_000, { magnet: false });
    expect(op.findClip(p, c.id)!.track.isMain).toBe(false);
    expect(c.startUs).toBe(2_000_000);
  });
});

describe('split, delete, trim', () => {
  it('split keeps total length and source continuity', () => {
    const a = vid(); const p = setup(a);
    const c = op.addAssetClip(p, a, 0);
    const r = op.splitClip(p, c.id, 4_000_000)!;
    expect(c.durationUs).toBe(4_000_000); expect(r.startUs).toBe(4_000_000);
    expect(r.inUs).toBe(4_000_000); expect(r.durationUs).toBe(6_000_000);
    expect(op.projectDuration(p)).toBe(10_000_000);
    invariants(p);
  });
  it('split moves keyframes to the right part', () => {
    const a = vid(); const p = setup(a);
    const c = op.addAssetClip(p, a, 0);
    c.keyframes.push({ id: '1', property: 'scale', tUs: 1_000_000, value: 1, easing: 'linear' }, { id: '2', property: 'scale', tUs: 8_000_000, value: 2, easing: 'linear' });
    const r = op.splitClip(p, c.id, 5_000_000)!;
    expect(c.keyframes).toHaveLength(1); expect(r.keyframes[0].tUs).toBe(3_000_000);
  });
  it('split at edges is refused', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0);
    expect(op.splitClip(p, c.id, 0)).toBeNull();
    expect(op.splitClip(p, c.id, 10_000_000)).toBeNull();
  });
  it('deleting on main ripples', () => {
    const a = vid(), b = vid(3_000_000); const p = setup(a, b);
    const c1 = op.addAssetClip(p, a, 0); const c2 = op.addAssetClip(p, b, 99e9);
    op.deleteClips(p, [c1.id]);
    expect(c2.startUs).toBe(0); invariants(p);
  });
  it('Q deletes left of playhead, W right', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0);
    op.deleteSide(p, c.id, 3_000_000, 'left');
    expect(main(p).clips).toHaveLength(1);
    expect(main(p).clips[0].inUs).toBe(3_000_000); expect(main(p).clips[0].startUs).toBe(0);
    const id = main(p).clips[0].id;
    op.deleteSide(p, id, 2_000_000, 'right');
    expect(main(p).clips[0].durationUs).toBe(2_000_000);
  });
  it('trim respects source bounds', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0);
    op.trimClip(p, c.id, 'end', 5_000_000);  // cannot extend past source
    expect(c.durationUs).toBe(10_000_000);
    op.trimClip(p, c.id, 'start', 2_000_000);
    expect(c.inUs).toBe(2_000_000); expect(c.durationUs).toBe(8_000_000); expect(c.startUs).toBe(0);
    op.trimClip(p, c.id, 'start', -5_000_000);
    expect(c.inUs).toBe(0); expect(c.durationUs).toBe(10_000_000);
  });
  it('trim on overlay track stops at neighbours', () => {
    const p = setup(); const c1 = op.addTextClip(p, 0); const c2 = op.addTextClip(p, 3_000_000);
    expect(op.findClip(p, c1.id)!.track).toBe(op.findClip(p, c2.id)!.track);
    op.trimClip(p, c1.id, 'end', 2_000_000);
    expect(op.clipEnd(c1)).toBe(3_000_000);
  });
});

describe('move, speed, snapping, keyframes', () => {
  it('move refuses overlap on overlay tracks', () => {
    const p = setup(); const c1 = op.addTextClip(p, 0); op.addTextClip(p, 3_000_000);
    expect(op.moveClip(p, c1.id, 4_000_000)).toBe(false);
    expect(op.moveClip(p, c1.id, 6_000_000)).toBe(true);
  });
  it('speed 2x halves timeline length and keeps the source range', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0);
    op.setSpeed(p, c.id, 2);
    expect(c.durationUs).toBe(5_000_000);
    expect(op.sourceTimeAt(c, 5_000_000)).toBe(10_000_000);
  });
  it('reverse maps timeline start to source end', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0); c.reverse = true;
    expect(op.sourceTimeAt(c, 0)).toBe(10_000_000);
    expect(op.sourceTimeAt(c, 10_000_000)).toBe(0);
  });
  it('snaps to clip edges within tolerance', () => {
    const a = vid(); const p = setup(a); op.addAssetClip(p, a, 0);
    expect(op.snapTime(p, 10_050_000, 100_000)).toEqual({ t: 10_000_000, snapped: true });
    expect(op.snapTime(p, 5_000_000, 100_000).snapped).toBe(false);
  });
  it('keyframes interpolate and setProp updates the right keyframe', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0);
    op.toggleKeyframe(c, 'scale', 0);
    op.setProp(c, 'scale', 2_000_000, 2);
    expect(op.valueAt(c, 'scale', 1_000_000)).toBeCloseTo(1.5);
    expect(op.valueAt(c, 'scale', 5_000_000)).toBe(2);
    op.setProp(c, 'scale', 2_000_000, 3);
    expect(c.keyframes).toHaveLength(2);
    op.toggleKeyframe(c, 'scale', 2_000_000);
    expect(c.keyframes).toHaveLength(1);
  });
  it('duplicate on main inserts right after', () => {
    const a = vid(); const p = setup(a); const c = op.addAssetClip(p, a, 0);
    const d = op.duplicateClip(p, c.id)!;
    expect(d.startUs).toBe(10_000_000); invariants(p);
  });
});
