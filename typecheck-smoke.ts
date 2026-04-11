export {};

const post: NostalgiaPost = {
  id: 'post-1',
  title: 'Example post',
  username: 'nostalgia',
  isVideo: false,
  carouselMedia: null,
  timestamp: Date.now()
};

const progress: InstagramSyncProgress = {
  minId: '',
  maxId: '',
  synced: 0,
  failed: 0,
  total: 0,
  timestamp: Date.now()
};

const syncState: LocalizedSyncStatusState = {
  status: 'syncing',
  key: 'syncing',
  params: { percent: 25 }
};

/** @param {NostalgiaI18nApi} api */
function verifyI18nApi(api: NostalgiaI18nApi) {
  const currentLanguage = api.getLanguage();
  const translatedLabel = api.t('syncPosts');
  void currentLanguage;
  void translatedLabel;
}

void post;
void progress;
void syncState;
void verifyI18nApi;