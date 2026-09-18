import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCommentsList = vi.fn();
const mockCommentsGet = vi.fn();
const mockRepliesCreate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn().mockReturnValue({
      comments: { list: mockCommentsList, get: mockCommentsGet },
      replies: { create: mockRepliesCreate },
    }),
  },
}));

vi.mock('../../src/auth.js', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({}),
}));

const { listComments, getComment, replyToComment } =
  await import('../../src/tools/comments.js');

const openComment = {
  id: 'c1',
  author: { displayName: 'Ada' },
  createdTime: '2026-09-10T14:00:00Z',
  content: 'Tighten this paragraph',
  quotedFileContent: { value: 'The quick brown fox' },
  resolved: false,
  replies: [
    { id: 'r1', author: { displayName: 'Lin' }, createdTime: '2026-09-10T15:00:00Z', content: 'On it' },
  ],
};
const resolvedComment = {
  id: 'c2',
  author: { displayName: 'Bob' },
  createdTime: '2026-09-09T09:00:00Z',
  content: 'Fixed typo',
  resolved: true,
  replies: [],
};

describe('comments tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listComments formats author, quoted text, content, and replies', async () => {
    mockCommentsList.mockResolvedValue({ data: { comments: [openComment] } });
    const result = await listComments('file-1');
    expect(result).toContain('Ada');
    expect(result).toContain('On: "The quick brown fox"');
    expect(result).toContain('Tighten this paragraph');
    expect(result).toContain('↳ Lin');
    expect(result).toContain('id: c1');
    expect(result).toContain('[UNTRUSTED COMMENT CONTENT BELOW]');
  });

  it('listComments hides resolved comments by default and reports the count', async () => {
    mockCommentsList.mockResolvedValue({ data: { comments: [openComment, resolvedComment] } });
    const result = await listComments('file-1');
    expect(result).not.toContain('Fixed typo');
    expect(result).toContain('1 resolved comment(s) hidden.');
  });

  it('listComments includes resolved comments when asked', async () => {
    mockCommentsList.mockResolvedValue({ data: { comments: [openComment, resolvedComment] } });
    const result = await listComments('file-1', true);
    expect(result).toContain('Fixed typo');
    expect(result).toContain('RESOLVED');
  });

  it('listComments returns a message when there are no comments', async () => {
    mockCommentsList.mockResolvedValue({ data: { comments: [] } });
    expect(await listComments('file-1', true)).toBe('No comments found.');
  });

  it('getComment fetches one comment by id', async () => {
    mockCommentsGet.mockResolvedValue({ data: openComment });
    const result = await getComment('file-1', 'c1');
    expect(mockCommentsGet).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-1', commentId: 'c1' }));
    expect(result).toContain('Tighten this paragraph');
  });

  it('replyToComment posts a reply and passes the resolve action', async () => {
    mockRepliesCreate.mockResolvedValue({ data: { id: 'r2' } });
    const result = await replyToComment('file-1', 'c1', 'Done', true);
    expect(mockRepliesCreate).toHaveBeenCalledWith(expect.objectContaining({
      fileId: 'file-1',
      commentId: 'c1',
      requestBody: { content: 'Done', action: 'resolve' },
    }));
    expect(result).toContain('comment resolved');
    expect(result).toContain('r2');
  });
});
