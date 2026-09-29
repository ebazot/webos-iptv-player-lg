// Catch-up modes and URL placeholders follow the de-facto M3U conventions
// (Kodi pvr.iptvsimple, TiviMate, OTT Navigator).

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const FLUSSONIC_URL = /^(https?:\/\/[^/]+)\/(.*)\/([^/]*)(mpegts|\.m3u8)(\?.+=.+)?$/i;
const PLACEHOLDER = /\$?\{(utc|utcend|lutc|start|end|now|timestamp|duration|offset|Y|m|d|H|M|S|channel-id)(?::([^}]*))?\}/g;

function appendQuery(url: string, query: string): string {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + query;
}

export function flussonicCatchupSource(url: string): string {
  const match = url.match(FLUSSONIC_URL);
  if (!match) return '';
  const [, host, path, name, type, query = ''] = match;
  if (type.toLowerCase() === 'mpegts') return `${host}/${path}/timeshift_abs-{utc}.ts${query}`;
  return `${host}/${path}/${name || 'index'}-{utc}-{duration}.m3u8${query}`;
}

/** Expand a channel's catch-up mode into a full URL template ('' when none). */
export function resolveCatchupSource(mode: string, source: string, url: string): string {
  switch (mode.toLowerCase()) {
    case 'append':
      if (!source) return '';
      return ABSOLUTE_URL.test(source) ? source : url + source;
    case 'shift':
    case 'timeshift':
      return source || appendQuery(url, 'utc={utc}&lutc={lutc}');
    case 'flussonic':
    case 'flussonic-hls':
    case 'flussonic-ts':
    case 'fs':
      return source || flussonicCatchupSource(url);
    default:
      return source;
  }
}

const pad2 = (value: number): string => (value < 10 ? '0' : '') + String(value);

function formatTime(seconds: number, format: string): string {
  const date = new Date(seconds * 1000);
  return format.replace(/[YmdHMS]/g, token => {
    switch (token) {
      case 'Y': return String(date.getFullYear());
      case 'm': return pad2(date.getMonth() + 1);
      case 'd': return pad2(date.getDate());
      case 'H': return pad2(date.getHours());
      case 'M': return pad2(date.getMinutes());
      default: return pad2(date.getSeconds());
    }
  });
}

function divide(value: number, divisor: string | undefined): string {
  const n = parseInt(divisor || '', 10);
  return String(Math.floor(value / (n > 0 ? n : 1)));
}

/** Fill every catch-up placeholder in `template`. Times are Unix seconds. */
export function renderCatchupUrl(
  template: string,
  start: number,
  end: number,
  channelId: string,
  now = Math.floor(Date.now() / 1000),
): string {
  return template.replace(PLACEHOLDER, (_match, name: string, arg: string | undefined) => {
    switch (name) {
      case 'Y': case 'm': case 'd': case 'H': case 'M': case 'S':
        return formatTime(start, name);
      case 'duration':
        return divide(end - start, arg);
      case 'offset':
        return divide(Math.max(0, now - start), arg);
      case 'channel-id':
        return encodeURIComponent(channelId);
      default: {
        const time = name === 'utc' || name === 'start' ? start
          : name === 'utcend' || name === 'end' ? end
            : now;
        return arg === undefined ? String(time) : formatTime(time, arg);
      }
    }
  });
}
