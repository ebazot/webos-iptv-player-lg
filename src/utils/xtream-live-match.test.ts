import { describe, expect, it } from 'vitest';
import { createXtreamLiveMatcher } from './xtream-live-match';

describe('createXtreamLiveMatcher', () => {
  const match = createXtreamLiveMatcher([
    { streamId: '101', directSource: '' },
    { streamId: '102', directSource: '' },
    { streamId: '103', directSource: 'https://host/token/c?x=1&token=old' },
  ]);

  it('matches standard, explicit-query, and direct-source Live identities', () => {
    expect(match('http://host/live/u1/p1/101.ts')).toBe('101');
    expect(match('http://host/u1/p1/101')).toBe('101');
    expect(match('http://host/play?stream_id=102')).toBe('102');
    expect(match('http://host/play?stream=102')).toBe('102');
    expect(match('https://host/token/c?token=new&x=1')).toBe('103');
  });

  it('does not infer identity from arbitrary paths or generic id parameters', () => {
    expect(match('http://host/vod/u1/p1/101.mkv')).toBe('');
    expect(match('http://host/proxy/live/101.ts')).toBe('');
    expect(match('http://host/play?id=101')).toBe('');
    expect(match('not a url')).toBe('');
  });

  it('matches standard Live paths relative to a path-prefixed portal', () => {
    const prefixed = createXtreamLiveMatcher([
      { streamId: '101', directSource: '' },
    ], 'http://host/panel');

    expect(prefixed('http://host/panel/live/u1/p1/101.ts')).toBe('101');
    expect(prefixed('http://host/live/u1/p1/101.ts')).toBe('101');
    expect(prefixed('https://cdn/live/u1/p1/101.ts')).toBe('101');
  });

  it('rejects query-id collisions on explicit VOD routes', () => {
    expect(match('http://host/movie/u1/p1/201.mp4?stream_id=101')).toBe('');
    expect(match('http://host/series/u1/p1/201.mkv?stream=102')).toBe('');
    expect(match('http://host/vod/u1/p1/201.mkv?stream_id=101')).toBe('');
  });

  it('keeps an authoritative direct source even when its path resembles VOD', () => {
    const direct = createXtreamLiveMatcher([
      {
        streamId: '201',
        directSource: 'https://host/movie/u1/p1/live.ts?token=old',
      },
    ]);

    expect(direct('https://host/movie/u1/p1/live.ts?token=new')).toBe('201');
  });

  it('does not use an ambiguous normalized direct source', () => {
    const ambiguous = createXtreamLiveMatcher([
      { streamId: '201', directSource: 'https://host/play?token=a' },
      { streamId: '202', directSource: 'https://host/play?token=b' },
    ]);

    expect(ambiguous('https://host/play?token=c')).toBe('');
    expect(ambiguous('https://host/play?token=a')).toBe('201');
  });

  it('does not choose arbitrarily between duplicate exact direct sources', () => {
    const ambiguous = createXtreamLiveMatcher([
      { streamId: '201', directSource: 'https://host/play' },
      { streamId: '202', directSource: 'https://host/play' },
    ]);

    expect(ambiguous('https://host/play')).toBe('');
  });
});
