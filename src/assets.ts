import { AssetType, defineAssets } from '@iwsdk/core';
import { KIT, kitAssetId } from './kit-manifest.js';
import { CALM_MUSIC_ID, MUSIC_ID, SFX_FILES, sfxAssetId } from './sfx-manifest.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const entries: Record<string, { url: string; type: AssetType; name: string; priority: 'lazy' }> = {};
for (const [key, m] of Object.entries(KIT)) {
  entries[kitAssetId(key)] = { url: publicAssetUrl(m.path), type: AssetType.GLTF, name: key, priority: 'lazy' };
}
for (const s of SFX_FILES) {
  entries[sfxAssetId(s)] = { url: publicAssetUrl(`audio/sfx/${s}.ogg`), type: AssetType.Audio, name: s, priority: 'lazy' };
}
entries[MUSIC_ID] = { url: publicAssetUrl('audio/music-fight-loop.ogg'), type: AssetType.Audio, name: 'Fight loop', priority: 'lazy' };
entries[CALM_MUSIC_ID] = { url: publicAssetUrl('audio/music-calm-loop.ogg'), type: AssetType.Audio, name: 'Calm loop', priority: 'lazy' };

export default defineAssets({
  ...entries,
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    name: 'Welcome Panel',
  },
});
