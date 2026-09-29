import { describe, it, expect } from 'vitest';
import { flussonicCatchupSource, renderCatchupUrl, resolveCatchupSource } from './catchup-url';

describe('resolveCatchupSource', () => {
  it('keeps default-mode sources unchanged', () => {
    expect(resolveCatchupSource('default', 'http://host/archive/{utc}', 'http://host/a'))
      .toBe('http://host/archive/{utc}');
    expect(resolveCatchupSource('', '', 'http://host/a')).toBe('');
  });

  it('appends relative sources and keeps absolute ones in append mode', () => {
    expect(resolveCatchupSource('append', '?utc={utc}', 'http://host/a')).toBe('http://host/a?utc={utc}');
    expect(resolveCatchupSource('append', 'http://host/b/{utc}', 'http://host/a')).toBe('http://host/b/{utc}');
    expect(resolveCatchupSource('append', '', 'http://host/a')).toBe('');
  });

  it('builds shift query parameters', () => {
    expect(resolveCatchupSource('shift', '', 'http://host/a')).toBe('http://host/a?utc={utc}&lutc={lutc}');
    expect(resolveCatchupSource('timeshift', '', 'http://host/a?x=1')).toBe('http://host/a?x=1&utc={utc}&lutc={lutc}');
  });
});

describe('flussonicCatchupSource', () => {
  it('derives HLS and MPEG-TS archive URLs', () => {
    expect(flussonicCatchupSource('http://host/ch1/mono.m3u8?token=t'))
      .toBe('http://host/ch1/mono-{utc}-{duration}.m3u8?token=t');
    expect(flussonicCatchupSource('http://host/ch1/mpegts?token=t'))
      .toBe('http://host/ch1/timeshift_abs-{utc}.ts?token=t');
    expect(flussonicCatchupSource('http://host/a')).toBe('');
  });
});

describe('renderCatchupUrl', () => {
  const start = 1_700_000_000;
  const end = start + 3600;
  const now = start + 7200;

  it('replaces every occurrence of the Unix-time placeholders', () => {
    expect(renderCatchupUrl('http://host/{utc}/{utc}-{utcend}?n={lutc}', start, end, 'ch1', now))
      .toBe(`http://host/${start}/${start}-${end}?n=${now}`);
    expect(renderCatchupUrl('http://host/?s=${start}&e=${end}&t=${timestamp}', start, end, 'ch1', now))
      .toBe(`http://host/?s=${start}&e=${end}&t=${now}`);
  });

  it('supports duration and offset with divisors', () => {
    expect(renderCatchupUrl('{duration}/{duration:60}/${offset}/{offset:60}', start, end, 'ch1', now))
      .toBe('3600/60/7200/120');
  });

  it('formats date placeholders', () => {
    const d = new Date(start * 1000);
    const p = (n: number) => (n < 10 ? '0' : '') + String(n);
    const ymd = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const hms = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    expect(renderCatchupUrl('{Y}{m}{d}-{H}{M}{S}', start, end, 'ch1', now)).toBe(`${ymd}-${hms}`);
    expect(renderCatchupUrl('{utc:YmdHMS}', start, end, 'ch1', now)).toBe(ymd + hms);
  });

  it('encodes the channel id', () => {
    expect(renderCatchupUrl('http://host/{channel-id}/{utc}', start, end, 'ch 1', now))
      .toBe(`http://host/ch%201/${start}`);
  });
});
