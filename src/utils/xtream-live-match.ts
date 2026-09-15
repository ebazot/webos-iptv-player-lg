import { stableStreamUrl } from './channel';
import { xtreamCredentialsFromLiveUrl } from './xtream-url';

export interface XtreamLiveReference {
  streamId: string;
  directSource: string;
}

export function createXtreamLiveMatcher(
  references: readonly XtreamLiveReference[],
  baseUrl = '',
): (url: string) => string {
  const liveIds = new Set<string>();
  const exactSources = new Map<string, string | null>();
  const stableSources = new Map<string, string | null>();
  for (const reference of references) {
    liveIds.add(reference.streamId);
    if (!isHttpUrl(reference.directSource)) continue;
    addSource(exactSources, reference.directSource, reference.streamId);
    const stable = stableStreamUrl(reference.directSource);
    addSource(stableSources, stable, reference.streamId);
  }

  return url => {
    const exact = exactSources.get(url);
    if (exact !== undefined) return exact || '';
    if (url.indexOf('?') >= 0 && stableSources.size) {
      const stable = stableSources.get(stableStreamUrl(url));
      if (stable !== undefined) return stable || '';
    }
    if (isExplicitVodUrl(url)) return '';
    const inferred = xtreamCredentialsFromLiveUrl(url)
      || (baseUrl ? xtreamCredentialsFromLiveUrl(url, baseUrl) : null);
    if (inferred && liveIds.has(inferred.streamId)) return inferred.streamId;
    if (url.indexOf('?') >= 0) {
      const queryId = explicitQueryStreamId(url);
      if (queryId && liveIds.has(queryId)) return queryId;
    }
    return '';
  };
}

function addSource(
  sources: Map<string, string | null>,
  url: string,
  streamId: string,
): void {
  const existing = sources.get(url);
  sources.set(
    url,
    existing === undefined || existing === streamId ? streamId : null,
  );
}

function explicitQueryStreamId(value: string): string {
  try {
    const url = new URL(value);
    return url.searchParams.get('stream_id')
      || url.searchParams.get('stream')
      || '';
  } catch {
    return '';
  }
}

function isExplicitVodUrl(value: string): boolean {
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    if (parts.length < 4) return false;
    const kind = parts[parts.length - 4].toLowerCase();
    return kind === 'movie' || kind === 'series' || kind === 'vod';
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
