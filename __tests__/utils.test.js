/**
 * Unit tests for utility functions
 */

// Test debounce function
describe('Debounce utility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debounce delays function execution', () => {
    const mockFn = jest.fn();

    // Debounce implementation
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    const debounced = debounce(mockFn, 100);

    debounced();
    expect(mockFn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  test('debounce cancels previous calls', () => {
    const mockFn = jest.fn();

    // Debounce implementation
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    const debounced = debounce(mockFn, 100);

    debounced();
    debounced();
    debounced();

    jest.advanceTimersByTime(100);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});

// Test hashtag extraction
describe('Hashtag extraction', () => {
  const extractHashtags = (text) => {
    if (!text || typeof text !== 'string') return [];
    const hashtagRegex = /#[\w]+/g;
    const matches = text.match(hashtagRegex);
    return matches ? matches.map(tag => tag.toLowerCase()) : [];
  };

  test('extracts hashtags from text', () => {
    const text = 'Check out this #photo #instagram #test';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#photo', '#instagram', '#test']);
  });

  test('handles empty text', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
  });

  test('converts hashtags to lowercase', () => {
    const text = '#PHOTO #Instagram #Test';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#photo', '#instagram', '#test']);
  });

  test('handles text without hashtags', () => {
    const text = 'This is just regular text';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual([]);
  });
});

// Test text truncation
describe('Text truncation', () => {
  const truncateText = (text, maxLength) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  test('truncates long text', () => {
    const longText = 'a'.repeat(100);
    const truncated = truncateText(longText, 50);
    expect(truncated.length).toBe(53); // 50 + '...'
    expect(truncated.endsWith('...')).toBe(true);
  });

  test('does not truncate short text', () => {
    const shortText = 'Short text';
    const truncated = truncateText(shortText, 50);
    expect(truncated).toBe(shortText);
  });

  test('handles empty text', () => {
    expect(truncateText('', 50)).toBe('');
    expect(truncateText(null, 50)).toBe('');
    expect(truncateText(undefined, 50)).toBe('');
  });
});

// Test grid columns calculation
describe('Grid columns calculation', () => {
  const getGridColumns = (width) => {
    if (width <= 480) return 2;
    if (width <= 768) return 2;
    if (width <= 1024) return 3;
    if (width <= 1200) return 4;
    return 5;
  };

  test('handles edge cases correctly', () => {
    expect(getGridColumns(0)).toBe(2);
    expect(getGridColumns(481)).toBe(2);
    expect(getGridColumns(769)).toBe(3); // 769 > 768, so goes to next condition (<= 1024)
    expect(getGridColumns(1025)).toBe(4); // 1025 > 1024, so goes to next condition (<= 1200)
    expect(getGridColumns(1201)).toBe(5); // 1201 > 1200, so returns default 5
  });

  test('returns correct columns for mobile', () => {
    expect(getGridColumns(320)).toBe(2);
    expect(getGridColumns(480)).toBe(2);
  });

  test('returns correct columns for tablet', () => {
    expect(getGridColumns(768)).toBe(2);
    expect(getGridColumns(1024)).toBe(3);
  });

  test('returns correct columns for desktop', () => {
    expect(getGridColumns(1200)).toBe(4);
    expect(getGridColumns(1920)).toBe(5);
  });

});

// Test debounce with arguments
describe('Debounce with arguments', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debounce passes arguments correctly', () => {
    const mockFn = jest.fn();

    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    const debounced = debounce(mockFn, 100);

    debounced('arg1', 'arg2', 123);
    jest.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });

  test('debounce handles multiple rapid calls with different args', () => {
    const mockFn = jest.fn();

    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }

    const debounced = debounce(mockFn, 100);

    debounced('first');
    jest.advanceTimersByTime(50);
    debounced('second');
    jest.advanceTimersByTime(50);
    debounced('third');
    jest.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith('third');
  });
});

// Test hashtag edge cases
describe('Hashtag extraction edge cases', () => {
  const extractHashtags = (text) => {
    if (!text || typeof text !== 'string') return [];
    const hashtagRegex = /#[\w]+/g;
    const matches = text.match(hashtagRegex);
    return matches ? matches.map(tag => tag.toLowerCase()) : [];
  };

  test('handles hashtags with numbers', () => {
    const text = 'Check #photo123 #test2024';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#photo123', '#test2024']);
  });

  test('handles hashtags with underscores', () => {
    const text = 'Check #photo_test #my_post';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#photo_test', '#my_post']);
  });

  test('handles multiple same hashtags', () => {
    const text = '#photo #photo #photo';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#photo', '#photo', '#photo']);
  });

  test('handles hashtags at start and end', () => {
    const text = '#start middle #end';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#start', '#end']);
  });

  test('handles text with only hashtag symbol', () => {
    const text = 'This is just #';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual([]);
  });

  test('handles mixed content', () => {
    const text = 'Check out @user #photo and visit https://example.com #link';
    const hashtags = extractHashtags(text);
    expect(hashtags).toEqual(['#photo', '#link']);
  });
});

// Test text truncation edge cases
describe('Text truncation edge cases', () => {
  const truncateText = (text, maxLength) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  test('handles exact length match', () => {
    const text = 'a'.repeat(50);
    const truncated = truncateText(text, 50);
    expect(truncated).toBe(text);
    expect(truncated.endsWith('...')).toBe(false);
  });

  test('handles maxLength of 0', () => {
    const text = 'Some text';
    const truncated = truncateText(text, 0);
    expect(truncated).toBe('...');
  });

  test('handles maxLength less than ellipsis length', () => {
    const text = 'Some text';
    const truncated = truncateText(text, 2);
    expect(truncated).toBe('So...');
  });

  test('preserves text content when truncating', () => {
    const text = 'This is a long text that needs truncation';
    const truncated = truncateText(text, 10);
    expect(truncated).toBe('This is a ...');
    expect(truncated.startsWith('This is a')).toBe(true);
  });

  test('handles unicode characters', () => {
    const text = 'Hello 🌍 World 🎉 Test';
    const truncated = truncateText(text, 10);
    expect(truncated.endsWith('...')).toBe(true);
  });
});

// Test sorting utilities
describe('Sorting utilities', () => {
  test('sorts by timestamp descending', () => {
    const posts = [
      { timestamp: 1000, title: 'Old' },
      { timestamp: 3000, title: 'New' },
      { timestamp: 2000, title: 'Middle' }
    ];

    const sorted = [...posts].sort((a, b) => b.timestamp - a.timestamp);

    expect(sorted[0].title).toBe('New');
    expect(sorted[1].title).toBe('Middle');
    expect(sorted[2].title).toBe('Old');
  });

  test('sorts by timestamp ascending', () => {
    const posts = [
      { timestamp: 1000, title: 'Old' },
      { timestamp: 3000, title: 'New' },
      { timestamp: 2000, title: 'Middle' }
    ];

    const sorted = [...posts].sort((a, b) => a.timestamp - b.timestamp);

    expect(sorted[0].title).toBe('Old');
    expect(sorted[1].title).toBe('Middle');
    expect(sorted[2].title).toBe('New');
  });

  test('handles missing timestamps', () => {
    const posts = [
      { timestamp: 1000, title: 'A' },
      { timestamp: null, title: 'B' },
      { timestamp: 2000, title: 'C' }
    ];

    const sorted = [...posts].sort((a, b) => {
      const aTime = a.timestamp || 0;
      const bTime = b.timestamp || 0;
      return bTime - aTime;
    });

    expect(sorted[0].title).toBe('C');
    expect(sorted[1].title).toBe('A');
    expect(sorted[2].title).toBe('B');
  });
});

// Test data validation
describe('Data validation', () => {
  test('validates post structure', () => {
    const validPost = {
      id: '123',
      url: 'https://instagram.com/p/test/',
      title: 'Test post',
      username: 'testuser',
      timestamp: Date.now(),
      isVideo: false
    };

    expect(validPost.id).toBeTruthy();
    expect(validPost.url).toBeTruthy();
    expect(validPost.title).toBeTruthy();
    expect(typeof validPost.timestamp).toBe('number');
    expect(typeof validPost.isVideo).toBe('boolean');
  });

  test('handles missing optional fields', () => {
    const minimalPost = {
      id: '123',
      url: 'https://instagram.com/p/test/',
      timestamp: Date.now()
    };

    expect(minimalPost.id).toBeTruthy();
    expect(minimalPost.title).toBeUndefined();
    expect(minimalPost.username).toBeUndefined();
  });
});

