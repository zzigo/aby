import { describe, expect, test } from 'bun:test';
import { videoProxyFfmpegArgs, videoProxyObjectKey } from '../src/lib/server/av-video-proxies';

describe('AV web video proxies', () => {
  test('keeps the archival filename and places the derived MP4 below .aby-proxies', () => {
    expect(videoProxyObjectKey({
      destinationObjectKey: 'aby/mov/1960s/1962-Carnival of Souls/carnival.vob'
    })).toBe('aby/mov/1960s/1962-Carnival of Souls/.aby-proxies/carnival.web.mp4');
  });

  test('converts the first video and audio streams to conservative browser codecs', () => {
    const args = videoProxyFfmpegArgs('https://wasabi.invalid/source.vob', '/tmp/web.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('aac');
    expect(args).toContain('+faststart');
    expect(args).toContain('0:a:0?');
    expect(args.at(-1)).toBe('/tmp/web.mp4');
  });
});
