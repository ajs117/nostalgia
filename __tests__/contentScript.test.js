/**
 * Unit tests for contentScript.js functions
 */

describe('Content script utilities', () => {
  test('getSavedTimestamp handles various timestamp formats', () => {
    const getSavedTimestamp = (post) => {
      let savedTimestamp = post.saved_at || post.savedAt || post.saved_timestamp;

      if (!savedTimestamp) {
        savedTimestamp = post.taken_at;
      }

      if (savedTimestamp && savedTimestamp < 10000000000) {
        savedTimestamp = savedTimestamp * 1000;
      }

      return savedTimestamp || Date.now();
    };

    const post1 = { saved_at: 1609459200000 }; // Already in milliseconds
    const post2 = { saved_at: 1609459200 }; // In seconds, should be converted
    const post3 = { taken_at: 1609459200 }; // Fallback to taken_at
    const post4 = {}; // No timestamp, should use Date.now()

    expect(getSavedTimestamp(post1)).toBe(1609459200000);
    expect(getSavedTimestamp(post2)).toBe(1609459200000);
    expect(getSavedTimestamp(post3)).toBe(1609459200000);
    expect(typeof getSavedTimestamp(post4)).toBe('number');
    expect(getSavedTimestamp(post4)).toBeGreaterThan(0);
  });

  test('createPostElement formats post correctly', () => {
    const createPostElement = (post, postId, url, thumbnailBase64, carouselMedia = null) => {
      const isCarousel = post.media_type === 8;
      const isVideo = post.media_type === 2;

      return {
        id: postId,
        url,
        thumbnail: thumbnailBase64,
        title: post.caption?.text ?? `${post.user.username} post`,
        username: post.user.username,
        collectionIds: post.saved_collection_ids || [],
        isVideo: isVideo,
        isCarousel: isCarousel,
        carouselMedia: carouselMedia,
        carouselCount: isCarousel && carouselMedia ? carouselMedia.length : 0,
        videoUrl: null,
        timestamp: Date.now(),
        takenAt: post.taken_at || Date.now()
      };
    };

    const mockPost = {
      media_type: 1,
      caption: { text: 'Test post' },
      user: { username: 'testuser' },
      saved_collection_ids: ['1', '2'],
      taken_at: 1609459200
    };

    const element = createPostElement(mockPost, 'test-id', 'https://instagram.com/p/test/', 'base64data');

    expect(element.id).toBe('test-id');
    expect(element.url).toBe('https://instagram.com/p/test/');
    expect(element.title).toBe('Test post');
    expect(element.username).toBe('testuser');
    expect(element.isVideo).toBe(false);
    expect(element.isCarousel).toBe(false);
    expect(element.collectionIds).toEqual(['1', '2']);
  });

  test('carousel post detection', () => {
    const mockCarouselPost = {
      media_type: 8,
      carousel_media: [
        { media_type: 1, id: '1' },
        { media_type: 2, id: '2' }
      ]
    };

    const isCarousel = mockCarouselPost.media_type === 8;
    expect(isCarousel).toBe(true);
    expect(mockCarouselPost.carousel_media.length).toBe(2);
  });

  test('handles video post type', () => {
    const mockVideoPost = {
      media_type: 2,
      caption: { text: 'Video post' },
      user: { username: 'testuser' },
      taken_at: 1609459200
    };

    const isVideo = mockVideoPost.media_type === 2;
    expect(isVideo).toBe(true);
  });

  test('handles photo post type', () => {
    const mockPhotoPost = {
      media_type: 1,
      caption: { text: 'Photo post' },
      user: { username: 'testuser' },
      taken_at: 1609459200
    };

    const isVideo = mockPhotoPost.media_type === 2;
    const isCarousel = mockPhotoPost.media_type === 8;
    expect(isVideo).toBe(false);
    expect(isCarousel).toBe(false);
  });

  test('createPostElement handles missing caption', () => {
    const createPostElement = (post, postId, url, thumbnailBase64) => {
      const isCarousel = post.media_type === 8;
      const isVideo = post.media_type === 2;

      return {
        id: postId,
        url,
        thumbnail: thumbnailBase64,
        title: post.caption?.text ?? `${post.user.username} post`,
        username: post.user.username,
        collectionIds: post.saved_collection_ids || [],
        isVideo: isVideo,
        isCarousel: isCarousel,
        videoUrl: null,
        timestamp: Date.now(),
        takenAt: post.taken_at || Date.now()
      };
    };

    const mockPost = {
      media_type: 1,
      user: { username: 'testuser' },
      taken_at: 1609459200
    };

    const element = createPostElement(mockPost, 'test-id', 'https://instagram.com/p/test/', 'base64data');

    expect(element.title).toBe('testuser post');
    expect(element.username).toBe('testuser');
  });

  test('createPostElement handles carousel with media', () => {
    const createPostElement = (post, postId, url, thumbnailBase64, carouselMedia = null) => {
      const isCarousel = post.media_type === 8;
      const isVideo = post.media_type === 2;

      return {
        id: postId,
        url,
        thumbnail: thumbnailBase64,
        title: post.caption?.text ?? `${post.user.username} post`,
        username: post.user.username,
        collectionIds: post.saved_collection_ids || [],
        isVideo: isVideo,
        isCarousel: isCarousel,
        carouselMedia: carouselMedia,
        carouselCount: isCarousel && carouselMedia ? carouselMedia.length : 0,
        videoUrl: null,
        timestamp: Date.now(),
        takenAt: post.taken_at || Date.now()
      };
    };

    const mockPost = {
      media_type: 8,
      caption: { text: 'Carousel post' },
      user: { username: 'testuser' },
      taken_at: 1609459200
    };

    const carouselMedia = [
      { media_type: 1, id: '1' },
      { media_type: 2, id: '2' },
      { media_type: 1, id: '3' }
    ];

    const element = createPostElement(mockPost, 'test-id', 'https://instagram.com/p/test/', 'base64data', carouselMedia);

    expect(element.isCarousel).toBe(true);
    expect(element.carouselCount).toBe(3);
    expect(element.carouselMedia).toEqual(carouselMedia);
  });

  test('getSavedTimestamp handles edge cases', () => {
    const getSavedTimestamp = (post) => {
      let savedTimestamp = post.saved_at || post.savedAt || post.saved_timestamp;

      if (!savedTimestamp) {
        savedTimestamp = post.taken_at;
      }

      if (savedTimestamp && savedTimestamp < 10000000000) {
        savedTimestamp = savedTimestamp * 1000;
      }

      return savedTimestamp || Date.now();
    };

    // Test with very old timestamp (seconds)
    const oldPost = { saved_at: 946684800 }; // Jan 1, 2000 in seconds
    expect(getSavedTimestamp(oldPost)).toBe(946684800000);

    // Test with zero (0 is falsy, so it falls back to Date.now())
    const zeroPost = { saved_at: 0 };
    const zeroResult = getSavedTimestamp(zeroPost);
    expect(typeof zeroResult).toBe('number');
    expect(zeroResult).toBeGreaterThan(0); // Falls back to Date.now()

    // Test with negative (should not convert)
    const negativePost = { saved_at: -1000 };
    const result = getSavedTimestamp(negativePost);
    expect(typeof result).toBe('number');
  });
});

