import { getRepository } from '../src/lib/server/repository';
import { generateSpectrogramAnalysis } from '../src/lib/server/spectrogram';

const [ownerId, assetId] = process.argv.slice(2);
if (!ownerId || !assetId) throw new Error('Usage: bun run spectrogram:generate -- <owner-id> <asset-id>');

const repository = getRepository();
const asset = await repository.getAsset(ownerId, assetId);
if (!asset) throw new Error('Asset not found for this owner');
const analysis = await generateSpectrogramAnalysis(ownerId, asset, repository);
console.info(JSON.stringify(analysis, null, 2));
