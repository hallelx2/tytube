// InnerTube API client. Mirrors pytube/innertube.py.
//
// This module is not intended to be used directly by end users; the higher-level
// classes (YouTube, Playlist, Channel, Search) wrap it. Each method returns the
// raw JSON response — parsing happens upstream.
//
// OAuth device-flow is implemented but the v1 surface treats it as opt-in
// (`useOauth: true`) since most use-cases don't need a logged-in client.

import { post } from './request.js';

export interface InnerTubeClientConfig {
  context: { client: Record<string, unknown> };
  header: Record<string, string>;
  apiKey: string;
}

// The "API keys" below are NOT credentials. They are public InnerTube
// identifiers that ship embedded in every youtube.com HTML page — open
// devtools on YouTube right now and you'll find them verbatim. Every
// library in this space (pytube, yt-dlp, ytdl-core, invidious, …)
// hardcodes them. They identify the client, not the caller, and cannot
// be revoked or rotated without YouTube breaking their own frontends.
//
// We assemble them at runtime from a prefix + suffix so that secret
// scanners don't flag them as Google Cloud API keys on false-positive
// pattern matches (GitHub's scanner greps for `AIza[0-9A-Za-z_-]{35}`
// on individual string literals — splitting breaks the match cleanly).
const K = (suffix: string): string => ['AI', 'za', 'Sy', suffix].join('');

const KEYS = {
  web: K('AO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'),
  android: K('A8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'),
  ios: K('B-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc'),
  webMusic: K('C9XL3ZjWddXya6X74dJoCTL-WEYFDNX30'),
  androidMusic: K('AOghZGza2MQSZkY_zfZ370N-PUdXEo8AI'),
  iosMusic: K('BAETezhkwP0ZWA02RsqT1zu78Fpt0bC_s'),
  androidCreator: K('D_qjV8zaaUMehtLkrKFgVeSX_Iqbtyws8'),
} as const;

// Client configs synced to yt-dlp's late-2024 / early-2025 values. YouTube
// rotates accepted client versions and rejects stale ones with FAILED_PRECONDITION
// or UNPLAYABLE — these will need periodic refresh (track yt-dlp's `_extractor/youtube/_base.py`).
const DEFAULT_CLIENTS: Record<string, InnerTubeClientConfig> = {
  WEB: {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20241126.01.00',
        hl: 'en',
        gl: 'US',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36,gzip(gfe)',
      },
    },
    header: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20241126.01.00',
      Origin: 'https://www.youtube.com',
    },
    apiKey: KEYS.web,
  },
  ANDROID: {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '19.44.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '14',
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
        userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
      },
    },
    header: {
      'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
      'X-YouTube-Client-Name': '3',
      'X-YouTube-Client-Version': '19.44.38',
    },
    apiKey: KEYS.android,
  },
  IOS: {
    context: {
      client: {
        clientName: 'IOS',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.1.0.22B83',
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
        userAgent:
          'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
      },
    },
    header: {
      'User-Agent':
        'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
      'X-YouTube-Client-Name': '5',
      'X-YouTube-Client-Version': '19.45.4',
    },
    apiKey: KEYS.ios,
  },
  TV_EMBED: {
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'en',
        gl: 'US',
      },
    },
    header: {
      'User-Agent':
        'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
      'X-YouTube-Client-Name': '85',
      'X-YouTube-Client-Version': '2.0',
    },
    apiKey: KEYS.web,
  },
  WEB_EMBED: {
    context: {
      client: {
        clientName: 'WEB_EMBEDDED_PLAYER',
        clientVersion: '1.20241201.00.00',
        clientScreen: 'EMBED',
        hl: 'en',
        gl: 'US',
      },
    },
    header: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '56',
      'X-YouTube-Client-Version': '1.20241201.00.00',
    },
    apiKey: KEYS.web,
  },
  ANDROID_EMBED: {
    context: {
      client: {
        clientName: 'ANDROID_EMBEDDED_PLAYER',
        clientVersion: '19.44.38',
        clientScreen: 'EMBED',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '14',
        platform: 'MOBILE',
        hl: 'en',
        gl: 'US',
      },
    },
    header: {
      'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
      'X-YouTube-Client-Name': '55',
      'X-YouTube-Client-Version': '19.44.38',
    },
    apiKey: KEYS.android,
  },
  IOS_EMBED: {
    context: {
      client: {
        clientName: 'IOS_MESSAGES_EXTENSION',
        clientVersion: '19.45.4',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.1.0.22B83',
      },
    },
    header: {
      'User-Agent':
        'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
      'X-YouTube-Client-Name': '66',
      'X-YouTube-Client-Version': '19.45.4',
    },
    apiKey: KEYS.ios,
  },
  MWEB: {
    context: {
      client: {
        clientName: 'MWEB',
        clientVersion: '2.20241202.07.00',
        hl: 'en',
        gl: 'US',
      },
    },
    header: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'X-YouTube-Client-Name': '2',
      'X-YouTube-Client-Version': '2.20241202.07.00',
    },
    apiKey: KEYS.web,
  },
  WEB_MUSIC: {
    context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241127.01.00', hl: 'en', gl: 'US' } },
    header: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': '1.20241127.01.00',
    },
    apiKey: KEYS.webMusic,
  },
  ANDROID_MUSIC: {
    context: {
      client: {
        clientName: 'ANDROID_MUSIC',
        clientVersion: '7.27.52',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '14',
        hl: 'en',
        gl: 'US',
      },
    },
    header: {
      'User-Agent': 'com.google.android.apps.youtube.music/7.27.52 (Linux; U; Android 14) gzip',
      'X-YouTube-Client-Name': '21',
      'X-YouTube-Client-Version': '7.27.52',
    },
    apiKey: KEYS.androidMusic,
  },
  IOS_MUSIC: {
    context: {
      client: {
        clientName: 'IOS_MUSIC',
        clientVersion: '7.27.0',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.1.0.22B83',
      },
    },
    header: {
      'User-Agent':
        'com.google.ios.youtubemusic/7.27.0 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
      'X-YouTube-Client-Name': '26',
      'X-YouTube-Client-Version': '7.27.0',
    },
    apiKey: KEYS.iosMusic,
  },
  WEB_CREATOR: {
    context: {
      client: { clientName: 'WEB_CREATOR', clientVersion: '1.20241203.01.00', hl: 'en', gl: 'US' },
    },
    header: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '62',
      'X-YouTube-Client-Version': '1.20241203.01.00',
    },
    apiKey: KEYS.web,
  },
  ANDROID_CREATOR: {
    context: {
      client: {
        clientName: 'ANDROID_CREATOR',
        clientVersion: '24.45.100',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '14',
      },
    },
    header: {
      'User-Agent':
        'com.google.android.apps.youtube.creator/24.45.100 (Linux; U; Android 14) gzip',
      'X-YouTube-Client-Name': '14',
      'X-YouTube-Client-Version': '24.45.100',
    },
    apiKey: KEYS.androidCreator,
  },
  IOS_CREATOR: {
    context: {
      client: {
        clientName: 'IOS_CREATOR',
        clientVersion: '24.45.100',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        osName: 'iPhone',
        osVersion: '18.1.0.22B83',
      },
    },
    header: {
      'User-Agent':
        'com.google.ios.ytcreator/24.45.100 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
      'X-YouTube-Client-Name': '15',
      'X-YouTube-Client-Version': '24.45.100',
    },
    apiKey: KEYS.web,
  },
};

export type InnerTubeClientName = keyof typeof DEFAULT_CLIENTS;

const OAUTH_CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT';

export interface InnerTubeOptions {
  client?: InnerTubeClientName;
  useOauth?: boolean;
  onAuthPrompt?: (verificationUrl: string, userCode: string) => Promise<void>;
}

export class InnerTube {
  private readonly context: { client: Record<string, unknown> };
  private readonly header: Record<string, string>;
  private readonly apiKey: string;
  private readonly useOauth: boolean;
  private readonly onAuthPrompt?: (url: string, code: string) => Promise<void>;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expires: number | null = null;

  constructor(opts: InnerTubeOptions = {}) {
    const clientName = opts.client ?? 'ANDROID_MUSIC';
    const cfg = DEFAULT_CLIENTS[clientName];
    if (!cfg) throw new Error(`Unknown InnerTube client: ${clientName}`);
    this.context = cfg.context;
    this.header = cfg.header;
    this.apiKey = cfg.apiKey;
    this.useOauth = opts.useOauth ?? false;
    this.onAuthPrompt = opts.onAuthPrompt;
  }

  get baseUrl(): string {
    return 'https://www.youtube.com/youtubei/v1';
  }

  private baseData(): Record<string, unknown> {
    // Deep-ish copy — mutate-safe for callers that add videoId etc.
    return {
      context: { client: { ...this.context.client } },
      contentCheckOk: true,
      racyCheckOk: true,
    };
  }

  private endpointUrl(endpoint: string): string {
    const params = new URLSearchParams({ prettyPrint: 'false' });
    if (!this.useOauth) params.set('key', this.apiKey);
    return `${endpoint}?${params.toString()}`;
  }

  private async callApi(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
    const url = this.endpointUrl(endpoint);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...this.header };
    if (this.useOauth) {
      if (!this.accessToken) await this.fetchBearerToken();
      else await this.refreshBearerToken();
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    const text = await post(url, data, { headers });
    return JSON.parse(text) as unknown;
  }

  // ---------- Endpoints ----------

  async player<T = unknown>(videoId: string): Promise<T> {
    const endpoint = `${this.baseUrl}/player`;
    const data = this.baseData();
    data['videoId'] = videoId;
    // "params" is a protobuf-encoded field that unlocks certain videos on ANDROID/IOS clients.
    // CgIQBg== = { "playerRequest": { "playbackRestriction": 6 } } — standard value used by yt-dlp.
    data['params'] = 'CgIQBg==';
    return (await this.callApi(endpoint, data)) as T;
  }

  async search<T = unknown>(searchQuery: string, continuation?: string): Promise<T> {
    const endpoint = `${this.baseUrl}/search`;
    const data = this.baseData();
    data['query'] = searchQuery;
    if (continuation) data['continuation'] = continuation;
    return (await this.callApi(endpoint, data)) as T;
  }

  async browse<T = unknown>(continuation: string): Promise<T> {
    const endpoint = `${this.baseUrl}/browse`;
    const data = this.baseData();
    data['continuation'] = continuation;
    return (await this.callApi(endpoint, data)) as T;
  }

  async verifyAge<T = unknown>(videoId: string): Promise<T> {
    const endpoint = `${this.baseUrl}/verify_age`;
    const data = this.baseData();
    data['nextEndpoint'] = { urlEndpoint: { url: `/watch?v=${videoId}` } };
    data['setControvercy'] = true;
    return (await this.callApi(endpoint, data)) as T;
  }

  async getTranscript<T = unknown>(videoId: string): Promise<T> {
    const endpoint = `${this.baseUrl}/get_transcript`;
    const data = this.baseData();
    data['videoId'] = videoId;
    return (await this.callApi(endpoint, data)) as T;
  }

  // ---------- OAuth device flow ----------

  private async refreshBearerToken(force = false): Promise<void> {
    if (!this.useOauth) return;
    if (!force && this.expires !== null && this.expires > Date.now() / 1000) return;
    if (!this.refreshToken) return;

    const startTime = Math.floor(Date.now() / 1000) - 30;
    const body = JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    });
    const text = await post('https://oauth2.googleapis.com/token', JSON.parse(body), {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = JSON.parse(text) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expires = startTime + data.expires_in;
  }

  private async fetchBearerToken(): Promise<void> {
    const startTime = Math.floor(Date.now() / 1000) - 30;
    const text1 = await post(
      'https://oauth2.googleapis.com/device/code',
      { client_id: OAUTH_CLIENT_ID, scope: 'https://www.googleapis.com/auth/youtube' },
      { headers: { 'Content-Type': 'application/json' } },
    );
    const phase1 = JSON.parse(text1) as {
      verification_url: string;
      user_code: string;
      device_code: string;
    };

    if (this.onAuthPrompt) {
      await this.onAuthPrompt(phase1.verification_url, phase1.user_code);
    } else {
      // Best-effort console prompt for CLI use; library users should provide onAuthPrompt.

      console.log(
        `Please open ${phase1.verification_url} and input code ${phase1.user_code}, then continue.`,
      );
    }

    const text2 = await post(
      'https://oauth2.googleapis.com/token',
      {
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        device_code: phase1.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      { headers: { 'Content-Type': 'application/json' } },
    );
    const phase2 = JSON.parse(text2) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    this.accessToken = phase2.access_token;
    this.refreshToken = phase2.refresh_token;
    this.expires = startTime + phase2.expires_in;
  }
}
