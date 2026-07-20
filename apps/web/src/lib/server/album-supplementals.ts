import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { BookletPage } from '@zztt/aby-domain';
import { readConfig } from './config';
import { AbyError } from './errors';
import {
  assertAbyObjectKey, copyWasabiSupplementalObject, downloadWasabiSupplementalObject, uploadWasabiArtifact
} from './storage';

const execFileAsync = promisify(execFile);

export interface BookletCrop { x: number; y: number; width: number; height: number }

function safeName(value: string): string {
  const clean = value.normalize('NFC').replace(/\p{Cc}/gu, '').replace(/[\\/]+/g, '／').trim();
  if (!clean) throw new AbyError('supplemental_title_invalid', 'Album title cannot be empty', 400);
  return clean;
}

function scoreFilename(value: string): string {
  const clean = basename(value).normalize('NFC').replace(/\p{Cc}/gu, '').replace(/[\\/]+/g, '-').trim();
  if (!clean) throw new AbyError('score_filename_invalid', 'Score filename cannot be empty', 400);
  return clean;
}

function needsTransform(extension: string, crop?: BookletCrop, sourcePage?: number) {
  return Boolean(crop || sourcePage || ['.tif', '.tiff', '.eps'].includes(extension));
}

export function bookletDestination(albumObjectKey: string, title: string, pageNumber: number, extension: string): string {
  return assertAbyObjectKey(
    `${dirname(albumObjectKey)}/${safeName(title)}-booklet-${String(pageNumber).padStart(2, '0')}${extension}`,
    readConfig().audioPrefix
  );
}

export function scoreDestination(title: string, sourceObjectKey: string): string {
  return `libros/scores/${safeName(title)}/${scoreFilename(sourceObjectKey)}`;
}

export async function adoptBookletPage(input: {
  albumObjectKey: string;
  albumTitle: string;
  sourceObjectKey: string;
  pageNumber: number;
  sourcePage?: number;
  crop?: BookletCrop;
}): Promise<BookletPage> {
  const extension = extname(input.sourceObjectKey).toLocaleLowerCase();
  const transformed = needsTransform(extension, input.crop, input.sourcePage);
  const targetExtension = transformed ? '.jpg' : extension;
  const objectKey = bookletDestination(input.albumObjectKey, input.albumTitle, input.pageNumber, targetExtension);
  const contentType = transformed ? 'image/jpeg' : extension === '.pdf' ? 'application/pdf'
    : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';

  if (!transformed) {
    await copyWasabiSupplementalObject(input.sourceObjectKey, objectKey, true);
  } else {
    const config = readConfig();
    const directory = await mkdtemp(join(tmpdir(), 'aby-booklet-'));
    const source = join(directory, `source${extension}`);
    const rendered = join(directory, 'rendered.png');
    const output = join(directory, 'page.jpg');
    try {
      await downloadWasabiSupplementalObject(input.sourceObjectKey, source);
      let imageInput = source;
      if (['.pdf', '.eps'].includes(extension)) {
        const sourcePage = input.sourcePage ?? 1;
        await execFileAsync(config.GHOSTSCRIPT_PATH, [
          '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pngalpha', '-r150',
          `-dFirstPage=${sourcePage}`, `-dLastPage=${sourcePage}`, `-sOutputFile=${rendered}`, source
        ], { timeout: config.FFMPEG_TRANSCODE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 });
        imageInput = rendered;
      }
      const crop = input.crop;
      const filter = crop
        ? `crop=iw*${crop.width / 100}:ih*${crop.height / 100}:iw*${crop.x / 100}:ih*${crop.y / 100}`
        : 'null';
      await execFileAsync(config.FFMPEG_PATH, ['-y', '-v', 'error', '-i', imageInput, '-frames:v', '1', '-vf', filter, '-q:v', '2', output], {
        timeout: config.FFMPEG_TRANSCODE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024
      });
      await uploadWasabiArtifact(objectKey, output, contentType);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return {
    sourceObjectKey: input.sourceObjectKey,
    objectKey,
    pageNumber: input.pageNumber,
    ...(input.sourcePage ? { sourcePage: input.sourcePage } : {}),
    ...(input.crop ? { crop: input.crop } : {}),
    contentType,
    addedAt: new Date().toISOString()
  };
}
