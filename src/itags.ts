// Lookup table of YouTube's itag values. Mirrors pytube/itags.py.

export interface ItagInfo {
  resolution: string | null;
  abr: string | null;
}

export interface FormatProfile {
  resolution: string | null;
  abr: string | null;
  isLive: boolean;
  is3d: boolean;
  isHdr: boolean;
  isDash: boolean;
}

const t = (resolution: string | null, abr: string | null): ItagInfo => ({ resolution, abr });

export const PROGRESSIVE_VIDEO: Record<number, ItagInfo> = {
  5: t('240p', '64kbps'),
  6: t('270p', '64kbps'),
  13: t('144p', null),
  17: t('144p', '24kbps'),
  18: t('360p', '96kbps'),
  22: t('720p', '192kbps'),
  34: t('360p', '128kbps'),
  35: t('480p', '128kbps'),
  36: t('240p', null),
  37: t('1080p', '192kbps'),
  38: t('3072p', '192kbps'),
  43: t('360p', '128kbps'),
  44: t('480p', '128kbps'),
  45: t('720p', '192kbps'),
  46: t('1080p', '192kbps'),
  59: t('480p', '128kbps'),
  78: t('480p', '128kbps'),
  82: t('360p', '128kbps'),
  83: t('480p', '128kbps'),
  84: t('720p', '192kbps'),
  85: t('1080p', '192kbps'),
  91: t('144p', '48kbps'),
  92: t('240p', '48kbps'),
  93: t('360p', '128kbps'),
  94: t('480p', '128kbps'),
  95: t('720p', '256kbps'),
  96: t('1080p', '256kbps'),
  100: t('360p', '128kbps'),
  101: t('480p', '192kbps'),
  102: t('720p', '192kbps'),
  132: t('240p', '48kbps'),
  151: t('720p', '24kbps'),
  300: t('720p', '128kbps'),
  301: t('1080p', '128kbps'),
};

export const DASH_VIDEO: Record<number, ItagInfo> = {
  133: t('240p', null),
  134: t('360p', null),
  135: t('480p', null),
  136: t('720p', null),
  137: t('1080p', null),
  138: t('2160p', null),
  160: t('144p', null),
  167: t('360p', null),
  168: t('480p', null),
  169: t('720p', null),
  170: t('1080p', null),
  212: t('480p', null),
  218: t('480p', null),
  219: t('480p', null),
  242: t('240p', null),
  243: t('360p', null),
  244: t('480p', null),
  245: t('480p', null),
  246: t('480p', null),
  247: t('720p', null),
  248: t('1080p', null),
  264: t('1440p', null),
  266: t('2160p', null),
  271: t('1440p', null),
  272: t('4320p', null),
  278: t('144p', null),
  298: t('720p', null),
  299: t('1080p', null),
  302: t('720p', null),
  303: t('1080p', null),
  308: t('1440p', null),
  313: t('2160p', null),
  315: t('2160p', null),
  330: t('144p', null),
  331: t('240p', null),
  332: t('360p', null),
  333: t('480p', null),
  334: t('720p', null),
  335: t('1080p', null),
  336: t('1440p', null),
  337: t('2160p', null),
  394: t('144p', null),
  395: t('240p', null),
  396: t('360p', null),
  397: t('480p', null),
  398: t('720p', null),
  399: t('1080p', null),
  400: t('1440p', null),
  401: t('2160p', null),
  402: t('4320p', null),
  571: t('4320p', null),
  694: t('144p', null),
  695: t('240p', null),
  696: t('360p', null),
  697: t('480p', null),
  698: t('720p', null),
  699: t('1080p', null),
  700: t('1440p', null),
  701: t('2160p', null),
  702: t('4320p', null),
};

export const DASH_AUDIO: Record<number, ItagInfo> = {
  139: t(null, '48kbps'),
  140: t(null, '128kbps'),
  141: t(null, '256kbps'),
  171: t(null, '128kbps'),
  172: t(null, '256kbps'),
  249: t(null, '50kbps'),
  250: t(null, '70kbps'),
  251: t(null, '160kbps'),
  256: t(null, '192kbps'),
  258: t(null, '384kbps'),
  325: t(null, null),
  328: t(null, null),
};

export const ITAGS: Record<number, ItagInfo> = {
  ...PROGRESSIVE_VIDEO,
  ...DASH_VIDEO,
  ...DASH_AUDIO,
};

export const HDR: ReadonlySet<number> = new Set([330, 331, 332, 333, 334, 335, 336, 337]);
export const THREE_D: ReadonlySet<number> = new Set([82, 83, 84, 85, 100, 101, 102]);
export const LIVE: ReadonlySet<number> = new Set([91, 92, 93, 94, 95, 96, 132, 151]);

export function getFormatProfile(itag: number | string): FormatProfile {
  const code = typeof itag === 'string' ? parseInt(itag, 10) : itag;
  const info = ITAGS[code];
  return {
    resolution: info?.resolution ?? null,
    abr: info?.abr ?? null,
    isLive: LIVE.has(code),
    is3d: THREE_D.has(code),
    isHdr: HDR.has(code),
    isDash: code in DASH_AUDIO || code in DASH_VIDEO,
  };
}
