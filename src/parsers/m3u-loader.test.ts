import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndParseM3UInWorker } from './m3u-loader';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAndParseM3UInWorker', () => {
  it('streams records and keeps only channels matched by the Live catalog', async () => {
    const source = [
      '#EXTM3U url-tvg="http://host/guide.xml"',
      '#EXTINF:-1 group-title="Live" custom="v",Alpha',
      '#EXTVLCOPT:http-user-agent=Agent',
      '#EXTHTTP:{"Referer":"http://host/a"}',
      'http://host/live/u1/p1/101.ts',
      '#EXTINF:-1,Movie',
      'http://host/vod/u1/p1/101.mkv',
      '#EXTINF:-1,Series',
      'http://host/series/u1/p1/201',
      '#EXTINF:-1,Bravo',
      'http://host/play?stream_id=102',
      '#EXTINF:-1,Charlie',
      'https://host/token/c?token=new&x=1',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse(splitBytes(new TextEncoder().encode(source), 7))));

    const result = await fetchAndParseM3UInWorker({
      url: 'http://host/get.php',
      timeout: 5000,
      xtreamLive: [
        { streamId: '101', directSource: '' },
        { streamId: '102', directSource: '' },
        { streamId: '103', directSource: 'https://host/token/c?x=1&token=old' },
      ],
    });

    expect(result.data.channels.map(channel => channel.name))
      .toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(result.data.channels[0]).toMatchObject({
      group: 'Live',
      sourceAttributes: { custom: 'v' },
      extras: {
        'http-user-agent': 'Agent',
        'http-referrer': 'http://host/a',
      },
      catchupStreamId: '101',
    });
    expect(result.data.channels.map(channel => channel.catchupStreamId))
      .toEqual(['101', '102', '103']);
    expect(result.data.epgUrl).toBe('http://host/guide.xml');
    expect(result.metrics).toMatchObject({
      transport: 'stream',
      filter: 'live_catalog',
      channelsKept: 3,
      channelsDropped: 2,
    });
  });

  it('preserves every M3U metadata surface through catalog filtering and batching', async () => {
    const source = [
      '#EXTM3U url-tvg="http://host/a.xml,http://host/b.xml" '
        + 'tvg-url="http://host/c.xml" max-conn="2" custom-header="header-value"',
      '#PLAYLIST:Provider Playlist',
      '#EXTINF:-1 tvg-id="ch1" tvg-name="Alpha" tvg-logo="http://host/logo.png" '
        + 'group-title="Old" catchup="default" catchup-days="7" '
        + 'catchup-source="http://host/archive/{utc}" tvg-chno="12" '
        + 'tvg-shift="-1.5" radio="true" custom-field="custom-value",Display Name',
      '#EXTGRP:Live;Regional',
      '#EXTVLCOPT:http-user-agent=Agent',
      '#EXTVLCOPT:network-caching=1500',
      '#KODIPROP:inputstream.adaptive.license_type=clearkey',
      '#EXTHTTP:{"User-Agent":"Agent","Referer":"http://host/ref","X-Test":"header"}',
      'http://host/play?stream_id=101',
      '#EXTINF:-1 group-title="Dropped" custom-field="drop",Movie',
      '#EXTVLCOPT:http-user-agent=DroppedAgent',
      '#KODIPROP:inputstream.adaptive.license_type=widevine',
      '#EXTHTTP:{"X-Dropped":"yes"}',
      'http://host/vod/u/p/201.mp4',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse(splitBytes(new TextEncoder().encode(source), 11))));
    const channels = [] as Awaited<ReturnType<
      typeof fetchAndParseM3UInWorker
    >>['data']['channels'];

    const result = await fetchAndParseM3UInWorker({
      url: 'http://host/get.php',
      timeout: 5000,
      xtreamLive: [{ streamId: '101', directSource: '' }],
    }, chunk => {
      if (chunk.kind === 'channels') channels.push(...chunk.channels);
    });

    expect(channels).toEqual([{
      id: 'ch1',
      name: 'Alpha',
      logo: 'http://host/logo.png',
      group: 'Live',
      url: 'http://host/play?stream_id=101',
      extras: {
        'http-user-agent': 'Agent',
        'network-caching': '1500',
        'inputstream.adaptive.license_type': 'clearkey',
        'http-referrer': 'http://host/ref',
      },
      sourceAttributes: {
        'custom-field': 'custom-value',
        'kodiprop:inputstream.adaptive.license_type': 'clearkey',
      },
      httpHeaders: {
        'User-Agent': 'Agent',
        Referer: 'http://host/ref',
        'X-Test': 'header',
      },
      channelNumber: 12,
      tvgShift: -1.5,
      radio: true,
      sourceGroups: ['Live', 'Regional'],
      playlistIds: [],
      catchup: 'default',
      catchupSource: 'http://host/archive/{utc}',
      catchupStreamId: '101',
      catchupDays: 7,
    }]);
    expect(result.data).toMatchObject({
      channels: [],
      groups: ['Live', 'Regional'],
      epgUrl: 'http://host/a.xml',
      epgUrls: [
        'http://host/a.xml',
        'http://host/b.xml',
        'http://host/c.xml',
      ],
      headerAttributes: {
        'url-tvg': 'http://host/a.xml,http://host/b.xml',
        'tvg-url': 'http://host/c.xml',
        'max-conn': '2',
        'custom-header': 'header-value',
      },
      maxConnections: 2,
      name: 'Provider Playlist',
      format: 'extended-m3u',
      issues: [],
    });
    expect(result.metrics).toMatchObject({
      filter: 'live_catalog',
      channelsKept: 1,
      channelsDropped: 1,
    });
  });

  it('does not guess stream identity when the Live catalog is unavailable', async () => {
    const source = [
      '#EXTM3U',
      '#EXTINF:-1,Alpha',
      'http://host/live/u1/p1/101.ts',
      '#EXTINF:-1,Movie',
      'http://host/movie/u1/p1/201.mkv',
      '#EXTINF:-1,Alternate',
      'http://host/vod/u1/p1/202.mkv',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse([new TextEncoder().encode(source)])));

    const result = await fetchAndParseM3UInWorker({
      url: 'http://host/get.php',
      timeout: 5000,
      xtreamBaseUrl: 'http://host',
    });

    expect(result.data.channels.map(channel => channel.name))
      .toEqual(['Alpha', 'Movie', 'Alternate']);
    expect(result.metrics).toMatchObject({
      filter: 'unavailable',
      channelsDropped: 0,
    });
  });

  it('drops every entry when the authoritative Live catalog is empty', async () => {
    const source = [
      '#EXTM3U',
      '#EXTINF:-1,Movie',
      'http://host/movie/u1/p1/201.mkv',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse([new TextEncoder().encode(source)])));

    const result = await fetchAndParseM3UInWorker({
      url: 'http://host/get.php',
      timeout: 5000,
      xtreamLive: [],
      xtreamBaseUrl: 'http://host',
    });

    expect(result.data.channels).toEqual([]);
    expect(result.metrics).toMatchObject({
      filter: 'live_catalog',
      channelsDropped: 1,
    });
  });

  it('incrementally decodes a BOM-marked UTF-16 playlist', async () => {
    const source = '#EXTM3U\r\n#EXTINF:-1,Alpha\r\nhttp://host/a';
    const bytes = encodeUtf16(source, true);
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse(splitBytes(bytes, 3))));

    const result = await fetchAndParseM3UInWorker({
      url: 'http://host/list.m3u',
      timeout: 5000,
    });

    expect(result.data.channels.map(channel => channel.name)).toEqual(['Alpha']);
    expect(result.data.channels[0].url).toBe('http://host/a');
  });

  it('reports structured fetch failures without including the source URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
    })));

    await expect(fetchAndParseM3UInWorker({
      url: 'http://host/private-list.m3u?token=secret',
      timeout: 5000,
    })).rejects.toMatchObject({
      name: 'M3UWorkerError',
      message: 'HTTP 503: Unavailable',
      details: {
        stage: 'fetch',
        reason: 'http',
        filter: 'none',
        inputBytes: 0,
        chunks: 0,
      },
    });
  });

  it('emits retained channels in bounded batches', async () => {
    const lines = ['#EXTM3U'];
    for (let index = 0; index < 513; index++) {
      lines.push(`#EXTINF:-1,Channel ${String(index)}`, `http://host/${String(index)}`);
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      streamResponse([new TextEncoder().encode(lines.join('\n'))])));
    const batches: string[][] = [];

    const result = await fetchAndParseM3UInWorker({
      url: 'http://host/list.m3u',
      timeout: 5000,
    }, chunk => {
      if (chunk.kind === 'channels') {
        batches.push(chunk.channels.map(channel => channel.name));
      }
    });

    expect(batches.map(batch => batch.length)).toEqual([512, 1]);
    expect(batches[0][0]).toBe('Channel 0');
    expect(batches[1][0]).toBe('Channel 512');
    expect(result.data.channels).toEqual([]);
    expect(result.metrics.channelsKept).toBe(513);
  });
});

function streamResponse(chunks: Uint8Array[]): Response {
  let index = 0;
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

function splitBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return chunks;
}

function encodeUtf16(value: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(value.length * 2 + 2);
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const offset = index * 2 + 2;
    bytes[offset] = littleEndian ? code & 0xff : code >> 8;
    bytes[offset + 1] = littleEndian ? code >> 8 : code & 0xff;
  }
  return bytes;
}
