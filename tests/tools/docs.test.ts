import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDocumentsGet = vi.fn();
const mockDocumentsCreate = vi.fn();
const mockDocumentsBatchUpdate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    docs: vi.fn().mockReturnValue({
      documents: {
        get: mockDocumentsGet,
        create: mockDocumentsCreate,
        batchUpdate: mockDocumentsBatchUpdate,
      },
    }),
    drive: vi.fn().mockReturnValue({
      files: { update: vi.fn().mockResolvedValue({}) },
    }),
  },
}));

vi.mock('../../src/auth.js', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({}),
}));

const { getDoc, createDoc, appendToDoc, replaceInDoc } =
  await import('../../src/tools/docs.js');

describe('docs tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getDoc returns document title and text', async () => {
    mockDocumentsGet.mockResolvedValue({
      data: {
        title: 'My Doc',
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: 'Hello world\n' } }] } },
          ],
        },
      },
    });
    const result = await getDoc('doc-1');
    expect(result).toContain('My Doc');
    expect(result).toContain('Hello world');
  });

  it('createDoc returns new document id and title', async () => {
    mockDocumentsCreate.mockResolvedValue({ data: { documentId: 'new-doc-1', title: 'New Doc' } });
    const result = await createDoc('New Doc');
    expect(result).toContain('new-doc-1');
    expect(result).toContain('New Doc');
  });

  it('appendToDoc calls batchUpdate with insertText request', async () => {
    mockDocumentsGet.mockResolvedValue({ data: { body: { content: [{ endIndex: 10 }] } } });
    mockDocumentsBatchUpdate.mockResolvedValue({});
    await appendToDoc('doc-1', 'Appended text');
    expect(mockDocumentsBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-1' })
    );
  });

  it('replaceInDoc calls batchUpdate with replaceAllText request', async () => {
    mockDocumentsBatchUpdate.mockResolvedValue({
      data: { replies: [{ replaceAllText: { occurrencesChanged: 2 } }] },
    });
    const result = await replaceInDoc('doc-1', 'old text', 'new text');
    expect(mockDocumentsBatchUpdate).toHaveBeenCalled();
    expect(result).toContain('2');
  });
});
