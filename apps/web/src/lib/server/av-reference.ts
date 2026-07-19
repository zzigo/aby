import { AbyError } from './errors';

function decodeHtml(value: string) {
  return value.replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function textContent(html: string) {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|div|tr|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export async function importAvReference(requestedUrl: string) {
  let url: URL;
  try { url = new URL(requestedUrl); } catch { throw new AbyError('invalid_reference_url', 'Enter a valid reference URL', 400); }
  if (!['dvdbeaver.com', 'www.dvdbeaver.com'].includes(url.hostname.toLocaleLowerCase())) {
    throw new AbyError('unsupported_reference_host', 'The first manual importer is intentionally limited to DVDBeaver', 400);
  }
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Aby/0.1 metadata reference importer (https://aby.zztt.org)' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new AbyError('reference_fetch_failed', `DVDBeaver responded ${response.status}`, 502);
  const html = await response.text();
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '').replace(/\s*[|:-]\s*DVDBeaver.*$/i, '').trim();
  const imageMatches = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:jpe?g|png))["']/gi)].map((match) => match[1]!).filter((value) => /cover|front|package/i.test(value));
  const posterUrl = imageMatches[0] ? new URL(imageMatches[0], response.url).href : undefined;
  const relevant = textContent(html).filter((line) => /runtime|disc size|feature:|video bitrate|codec:|audio:|\b(?:blu-ray|dvd|1080p|2160p|lpcm|dolby|dts)\b/i.test(line));
  const editionNotes = [...new Set(relevant)].slice(0, 250).join('\n').slice(0, 50_000);
  return {
    title: title || undefined, posterUrl, editionNotes,
    source: { authority: 'dvdbeaver', externalId: response.url, canonicalUrl: response.url, fetchedAt: new Date().toISOString() }
  };
}
