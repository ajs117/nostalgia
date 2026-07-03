export {};

declare global {
  interface NostalgiaCarouselMedia {
    id: string;
    index: number;
    isVideo: boolean;
    imageUrl: string | null;
    width: number;
    height: number;
  }

  interface NostalgiaPost {
    id: string;
    link?: string;
    url?: string;
    thumbnail?: string | null;
    thumbnailKey?: string | null;
    image?: string | null;
    title?: string;
    username?: string;
    collectionIds?: string[];
    isVideo?: boolean;
    isCarousel?: boolean;
    carouselMedia?: NostalgiaCarouselMedia[] | null;
    carouselCount?: number;
    videoUrl?: string | null;
    timestamp?: number;
    takenAt?: number;
    savedOrder?: number;
  }

  interface ModalCachedMedia {
    isVideo: boolean;
    url: string;
    extension: string;
  }

  interface InstagramSyncProgress {
    minId: string;
    maxId: string;
    synced: number;
    failed: number;
    total: number;
    timestamp: number;
  }

  interface LocalizedSyncStatusState {
    status: string;
    key: string | null;
    params: Record<string, unknown> | null;
  }

  interface NostalgiaLanguageMetadata {
    label: string;
    lang: string;
    dir: 'ltr' | 'rtl';
  }

  interface NostalgiaI18nApi {
    detectLanguage(): string;
    getLanguages(): Record<string, NostalgiaLanguageMetadata>;
    getLanguage(): string;
    setLanguage(language: string): string;
    t(key: string, params?: Record<string, unknown>): string;
    applyTranslations(root?: Document): void;
  }
}