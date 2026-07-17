import { readConfig } from './config';

export interface WikidataInfo {
  qid: string;
  label: string;
  description: string;
  imageUrl?: string;
  birthDate?: string;
}

export async function fetchWikidataEntity(name: string): Promise<WikidataInfo | null> {
  const config = readConfig();
  const userAgent = `Aby/0.1.0 (${config.ABY_EXTERNAL_METADATA_CONTACT})`;
  
  try {
    // 1. Search for entity
    const searchUrl = new URL('https://www.wikidata.org/w/api.php');
    searchUrl.searchParams.set('action', 'wbsearchentities');
    searchUrl.searchParams.set('search', name);
    searchUrl.searchParams.set('language', 'en');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('limit', '1');

    const searchResponse = await fetch(searchUrl, { headers: { 'user-agent': userAgent } });
    if (!searchResponse.ok) return null;
    const searchData = await searchResponse.json() as { search?: Array<{ id: string; label: string; description: string }> };
    
    const entity = searchData.search?.[0];
    if (!entity) return null;
    
    const qid = entity.id;
    
    // 2. Fetch entity data
    const dataUrl = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
    const dataResponse = await fetch(dataUrl, { headers: { 'user-agent': userAgent } });
    if (!dataResponse.ok) return null;
    const dataBody = await dataResponse.json() as { entities?: Record<string, any> };
    
    const entityData = dataBody.entities?.[qid];
    if (!entityData) return null;
    
    // 3. Parse fields
    const label = entityData.labels?.es?.value || entityData.labels?.en?.value || entity.label;
    const description = entityData.descriptions?.es?.value || entityData.descriptions?.en?.value || entity.description;
    
    // Extract Image (P18)
    const imageClaim = entityData.claims?.P18?.[0];
    const imageFileName = imageClaim?.mainsnak?.datavalue?.value;
    let imageUrl: string | undefined;
    if (imageFileName) {
      imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFileName)}?width=400`;
    }

    // Extract Birth Date (P569)
    const birthDateClaim = entityData.claims?.P569?.[0];
    const birthDate = birthDateClaim?.mainsnak?.datavalue?.value?.time;

    return {
      qid,
      label,
      description,
      ...(imageUrl ? { imageUrl } : {}),
      ...(birthDate ? { birthDate: birthDate.replace(/^\+/, '').split('T')[0] } : {})
    };
  } catch (error) {
    console.error('Wikidata fetch failed:', error);
    return null;
  }
}
