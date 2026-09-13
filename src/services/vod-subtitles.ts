import type { SidecarSubtitle } from '../types';
import { parseSubtitleFile } from '../utils/srt';
import { fetchText } from '../utils/fetch-helper';
import { createLogger } from '../utils/logger';
import { t } from '../i18n';
import { WebVttCueTrack } from './webvtt-cue-track';
import type { VttCue } from '../utils/webvtt';

const log = createLogger('VodSubs');

/**
 * Loads Xtream sidecar subtitle files (SRT / WebVTT) into one reusable
 * application-created TextTrack. Empty `<track>` elements accept cues but do not
 * paint them on some older webOS releases, while `addTextTrack()` does.
 */
export class VodSubtitles {
  private entries: Array<{
    name: string;
    lang: string;
    url: string;
    text?: string;
    cues?: VttCue[];
    loading?: Promise<VttCue[]>;
  }> = [];
  private video: HTMLVideoElement | null = null;
  private cueTrack = new WebVttCueTrack();
  private gen = 0;
  private _activeIndex = -1;

  get activeIndex(): number {
    return this._activeIndex;
  }

  attach(video: HTMLVideoElement, sidecars: SidecarSubtitle[]): void {
    this.clear();
    this.video = video;
    this.entries = sidecars.map(sidecar => ({
      name: sidecar.name || sidecar.lang || t('player.subtitles'),
      lang: sidecar.lang,
      url: sidecar.url,
      text: sidecar.text,
    }));
    if (sidecars.length) log.info('attached', this.entries.length, 'sidecar track(s)');
  }

  async show(index: number): Promise<void> {
    const entry = this.entries[index];
    const video = this.video;
    if (!entry || !video) {
      this.hide();
      return;
    }
    if (this._activeIndex === index) return;
    const gen = ++this.gen;
    this._activeIndex = index;
    this.cueTrack.disable();
    try {
      const cues = await this.load(entry);
      if (gen !== this.gen) return;
      this.cueTrack.attach(video, entry.name, entry.lang);
      for (const cue of cues) {
        this.cueTrack.add(cue.start, cue.end, cue.text, cue.settings);
      }
      log.info('loaded', cues.length, 'cues from', entry.url);
    } catch (e) {
      if (gen === this.gen) {
        this._activeIndex = -1;
        this.cueTrack.disable();
      }
      log.warn(
        'VOD sidecar subtitle load failed',
        'event=xtream.subtitle.load.failed',
        e,
      );
    }
  }

  private load(entry: typeof this.entries[number]): Promise<VttCue[]> {
    if (entry.cues) return Promise.resolve(entry.cues);
    if (!entry.loading) {
      entry.loading = (entry.text != null
        ? Promise.resolve(entry.text)
        : fetchText(entry.url))
        .then(parseSubtitleFile)
        .then((cues) => {
          entry.cues = cues;
          entry.loading = undefined;
          return cues;
        }, (error: unknown) => {
          entry.loading = undefined;
          throw error;
        });
    }
    return entry.loading;
  }

  /** Append a sidecar downloaded during playback and return its picker index. */
  addOnline(video: HTMLVideoElement, sub: SidecarSubtitle): number {
    if (this.video !== video) {
      this.clear();
      this.video = video;
    }
    this.entries.push({
      name: sub.name || sub.lang || t('player.subtitles'),
      lang: sub.lang,
      url: sub.url,
      text: sub.text,
    });
    return this.entries.length - 1;
  }

  hide(): void {
    this.gen++;
    this._activeIndex = -1;
    this.cueTrack.disable();
  }

  setOffset(seconds: number): void {
    this.cueTrack.setOffset(seconds);
  }

  owns(track: TextTrack): boolean {
    return this.cueTrack.owns(track);
  }

  clear(): void {
    this.hide();
    this.entries = [];
    this.video = null;
  }
}
