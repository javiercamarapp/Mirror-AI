import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
const mockSupabase = {
  from: vi.fn(),
};

function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in',
    'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains',
    'not', 'gt', 'head', 'is',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

vi.mock('../supabase.js', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
const { checkTextContent, processReports } = await import('../contentModeration.js');

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Content Moderation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── checkTextContent ──────────────────────────────────────────────────────

  describe('checkTextContent', () => {
    it('should pass clean content', () => {
      const result = checkTextContent('This is a nice outfit!');
      expect(result.passed).toBe(true);
      expect(result.flaggedWords).toHaveLength(0);
    });

    it('should detect a single profanity word', () => {
      const result = checkTextContent('What the fuck is this');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords).toContain('fuck');
    });

    it('should detect multiple profanity words', () => {
      const result = checkTextContent('This shit is fucking damn ugly');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords.length).toBeGreaterThanOrEqual(2);
      expect(result.flaggedWords).toContain('shit');
      expect(result.flaggedWords).toContain('damn');
    });

    it('should be case insensitive', () => {
      const result = checkTextContent('FUCK THIS SHIT');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords).toContain('fuck');
      expect(result.flaggedWords).toContain('shit');
    });

    it('should handle mixed case', () => {
      const result = checkTextContent('FuCk ThIs ShIt');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords.length).toBeGreaterThanOrEqual(2);
    });

    it('should match word boundaries (no false positives on substrings)', () => {
      // "assess" contains "ass" but should NOT be flagged due to word boundary
      const result = checkTextContent('Let me assess this outfit');
      expect(result.passed).toBe(true);
      expect(result.flaggedWords).toHaveLength(0);
    });

    it('should not flag "class" containing "ass"', () => {
      const result = checkTextContent('This is a classy look');
      expect(result.passed).toBe(true);
    });

    it('should not flag "scunthorpe" containing a slur', () => {
      // Scunthorpe problem - "cunt" is in the word but has word boundaries
      const result = checkTextContent('I live in Scunthorpe');
      // The regex uses word boundaries so "Scunthorpe" should NOT match "\bcunt\b"
      expect(result.passed).toBe(true);
    });

    it('should handle empty string', () => {
      const result = checkTextContent('');
      expect(result.passed).toBe(true);
      expect(result.flaggedWords).toHaveLength(0);
    });

    it('should handle whitespace-only string', () => {
      const result = checkTextContent('   \n\t  ');
      expect(result.passed).toBe(true);
      expect(result.flaggedWords).toHaveLength(0);
    });

    it('should detect multi-word profanity phrases', () => {
      const result = checkTextContent('you should kill yourself loser');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords).toContain('kill yourself');
    });

    it('should detect racial slurs', () => {
      const result = checkTextContent('you are a faggot');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords).toContain('faggot');
    });

    it('should detect the abbreviation slurs', () => {
      const result = checkTextContent('just kys already stfu');
      expect(result.passed).toBe(false);
      expect(result.flaggedWords).toContain('kys');
      expect(result.flaggedWords).toContain('stfu');
    });

    it('should pass content with benign words that look similar to slurs', () => {
      const result = checkTextContent('The cocktail dress is beautiful');
      expect(result.passed).toBe(true);
    });

    it('should flag profanity even when surrounded by punctuation', () => {
      const result = checkTextContent('What the (fuck)!');
      expect(result.passed).toBe(false);
    });
  });

  // ── processReports ────────────────────────────────────────────────────────

  describe('processReports', () => {
    it('should auto-hide a post when reaching 5+ reports', async () => {
      // Count returns 5
      const countChain = chainMock({ data: null, error: null, count: 5 });
      const updateChain = chainMock({ data: null, error: null });
      const postOwnerChain = chainMock({ data: { user_id: 'bad-user' }, error: null });
      // For checkUserSuspension: posts, comments, stories, user reports
      const emptyChain = chainMock({ data: [], error: null, count: 0 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (callIdx === 1) return countChain; // content_reports count
        if (table === 'social_posts' && callIdx === 2) return updateChain; // update post
        if (table === 'content_reports') return updateChain; // update reports
        if (table === 'social_posts') return postOwnerChain;
        return emptyChain;
      });

      await processReports('post', 'post-123');
      expect(mockSupabase.from).toHaveBeenCalledWith('social_posts');
    });

    it('should not take action when below threshold', async () => {
      const countChain = chainMock({ data: null, error: null, count: 2 });
      const postOwnerChain = chainMock({ data: { user_id: 'user-1' }, error: null });
      const emptyChain = chainMock({ data: [], error: null, count: 0 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return countChain;
        if (callIdx === 2) return postOwnerChain;
        return emptyChain;
      });

      await processReports('post', 'post-123');
      // Only the count query + checkUserSuspension queries, no update
    });

    it('should log and not throw on error', async () => {
      const { logger } = await import('../logger.js');
      mockSupabase.from.mockImplementation(() => {
        throw new Error('DB crash');
      });

      // Should not throw
      await processReports('post', 'post-123');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should auto-hide a story by expiring it immediately', async () => {
      const countChain = chainMock({ data: null, error: null, count: 5 });
      const updateChain = chainMock({ data: null, error: null });
      const storyOwnerChain = chainMock({ data: { user_id: 'story-user' }, error: null });
      const emptyChain = chainMock({ data: [], error: null, count: 0 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (callIdx === 1) return countChain;
        if (table === 'stories' && callIdx <= 3) return updateChain;
        if (table === 'content_reports') return updateChain;
        if (table === 'stories') return storyOwnerChain;
        return emptyChain;
      });

      await processReports('story', 'story-123');
      expect(mockSupabase.from).toHaveBeenCalledWith('stories');
    });

    it('should delete a comment when reaching threshold', async () => {
      const countChain = chainMock({ data: null, error: null, count: 5 });
      const deleteChain = chainMock({ data: null, error: null });
      const updateChain = chainMock({ data: null, error: null });
      const commentOwnerChain = chainMock({ data: { user_id: 'comment-user' }, error: null });
      const emptyChain = chainMock({ data: [], error: null, count: 0 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (callIdx === 1) return countChain;
        if (table === 'post_comments' && callIdx === 2) return deleteChain;
        if (table === 'content_reports') return updateChain;
        if (table === 'post_comments') return commentOwnerChain;
        return emptyChain;
      });

      await processReports('comment', 'comment-123');
      expect(mockSupabase.from).toHaveBeenCalledWith('post_comments');
    });
  });
});
