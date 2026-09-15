#!/usr/bin/env node
// Stream the webOS app's DevTools console to the terminal over the Chrome
// DevTools Protocol — the same console `ares-inspect` shows in its GUI, but
// headless so it can be captured without copy-pasting out of a browser tab.
//
// Usage:
//   node scripts/tv-logs.mjs [--app <id>] [--port 9998] [--seconds N] [--history]
// IP comes from `ares-setup-device` (default device, or TV_DEVICE=<name>).
import {
  connectCdpWithAresFallback,
  resolveConfiguredDeviceIp,
} from './cdp-client.mjs';
import {
  enableCdpLogs,
  normalizeCdpLogEvent,
  subscribeCdpLogs,
} from './cdp-logs.mjs';

const DEFAULT_APP_ID = 'com.lennylxx.iptv';
const DEFAULT_PORT = 9998;
const DEFAULT_SECONDS = 0;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const appId = option('--app', DEFAULT_APP_ID);
const port = Number(option('--port', String(DEFAULT_PORT)));
const seconds = Number(option('--seconds', String(DEFAULT_SECONDS)));
const history = args.includes('--history');
const toErrorMessage = (value) => {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value?.message === 'string' && value.message) return value.message;
  return String(value);
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('tv-logs: --port must be an integer from 1 to 65535');
  process.exit(2);
}
if (!Number.isInteger(seconds) || seconds < 0) {
  console.error('tv-logs: --seconds must be a non-negative integer');
  process.exit(2);
}

// Resolve the device IP from ares-setup-device (no secrets needed for CDP).
let ip;
try {
  ip = resolveConfiguredDeviceIp();
} catch (e) {
  console.error(`tv-logs: ${toErrorMessage(e)}`);
  process.exit(1);
}

let connection;
try {
  connection = await connectCdpWithAresFallback({
    appId,
    device: process.env.TV_DEVICE,
    host: ip,
    port,
    target: appId,
    targetSelection: 'legacy-tv-app',
  });
} catch (e) {
  console.error(`tv-logs: ${toErrorMessage(e)}`);
  process.exit(1);
}

const { client, target: page } = connection;
console.error(`tv-logs: attached to "${page?.title || ''}" (${page?.description || page?.url || ''})`);

subscribeCdpLogs(client, (method, params) => {
  const event = normalizeCdpLogEvent(method, params);
  const stamp = new Date(event.observedAt).toTimeString().slice(0, 8);
  if (event.source === 'console') {
    const tag = event.level === 'log' ? '' : `.${event.level}`;
    console.log(`${stamp} [console${tag}] ${event.text}`);
  } else if (event.source === 'exception') {
    console.log(`${stamp} [exception] ${event.text}`);
  } else {
    console.log(`${stamp} [${event.level}] ${event.text}`);
  }
});
client.socket.addEventListener('error', (event) => {
  console.error('tv-logs: ws error', event.message || event);
});
client.socket.addEventListener('close', () => {
  connection.close();
  process.exit(0);
});

void enableCdpLogs(client, { history }).catch((error) => {
  console.error(`tv-logs: ${toErrorMessage(error)}`);
  client.close();
});

if (seconds > DEFAULT_SECONDS) setTimeout(() => connection.close(), seconds * 1000);
process.on('SIGINT', () => connection.close());
process.on('SIGTERM', () => connection.close());
