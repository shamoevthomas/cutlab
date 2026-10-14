import { it, expect } from 'vitest';
import { parseSubtitles, writeSrt } from '../src/model/srt';

it('parses SRT and VTT and round-trips', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nBonjour\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>ligne</i> deux\r\nsuite\r\n';
  const cues = parseSubtitles(srt);
  expect(cues).toEqual([{ startUs: 1e6, endUs: 2.5e6, text: 'Bonjour' }, { startUs: 3e6, endUs: 4e6, text: 'ligne deux\nsuite' }]);
  expect(parseSubtitles(writeSrt(cues))).toEqual(cues);
  expect(parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.000\nx')).toEqual([{ startUs: 1e6, endUs: 2e6, text: 'x' }]);
  expect(parseSubtitles('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx')).toEqual([{ startUs: 1e6, endUs: 2e6, text: 'x' }]);
});
