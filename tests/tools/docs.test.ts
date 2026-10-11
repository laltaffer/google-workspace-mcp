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

describe('docs structure', () => {
  beforeEach(() => vi.clearAllMocks());

  const para = (text: string, extra: Record<string, unknown> = {}, startIndex = 1) => ({
    startIndex,
    paragraph: { elements: [{ textRun: { content: text } }], ...extra },
  });

  it('getDoc renders headings, bullets, links, and tables', async () => {
    const { getDoc } = await import('../../src/tools/docs.js');
    mockDocumentsGet.mockResolvedValue({
      data: {
        title: 'Rich',
        body: {
          content: [
            para('Title\n', { paragraphStyle: { namedStyleType: 'HEADING_1' } }, 1),
            para('Sub\n', { paragraphStyle: { namedStyleType: 'HEADING_2' } }, 7),
            para('one\n', { bullet: { listId: 'l', nestingLevel: 0 } }, 11),
            para('two\n', { bullet: { listId: 'l', nestingLevel: 1 } }, 15),
            {
              startIndex: 19,
              paragraph: {
                elements: [
                  { textRun: { content: 'see ' } },
                  { textRun: { content: 'docs', textStyle: { link: { url: 'https://x.test' } } } },
                  { textRun: { content: '\n' } },
                ],
              },
            },
            {
              startIndex: 28,
              table: {
                tableRows: [
                  { tableCells: [{ content: [para('a\n')] }, { content: [para('b\n')] }] },
                  { tableCells: [{ content: [para('c\n')] }, { content: [para('d\n')] }] },
                ],
              },
            },
            { startIndex: 40, sectionBreak: {} },
          ],
        },
      },
    });
    const out = await getDoc('id');
    expect(out).toContain('# Title\n');
    expect(out).toContain('## Sub\n');
    expect(out).toContain('- one\n');
    expect(out).toContain('  - two\n');
    expect(out).toContain('see [docs](https://x.test)\n');
    expect(out).toContain('| a | b |\n| --- | --- |\n| c | d |\n');
    expect(out).not.toContain('@1');
  });

  it('getDoc appends start indices when asked', async () => {
    const { getDoc } = await import('../../src/tools/docs.js');
    mockDocumentsGet.mockResolvedValue({
      data: { title: 'T', body: { content: [para('x\n', {}, 1), para('y\n', {}, 3)] } },
    });
    const out = await getDoc('id', true);
    expect(out).toContain('[@1] x\n');
    expect(out).toContain('[@3] y\n');
  });

  it('batchUpdateDoc passes requests through and summarizes replies', async () => {
    const { batchUpdateDoc } = await import('../../src/tools/docs.js');
    mockDocumentsBatchUpdate.mockResolvedValue({
      data: { replies: [{}, { replaceAllText: { occurrencesChanged: 2 } }] },
    });
    const requests = [{ insertText: { location: { index: 1 }, text: 'hi' } }, { replaceAllText: {} }];
    const out = await batchUpdateDoc('id', requests);
    expect(mockDocumentsBatchUpdate).toHaveBeenCalledWith({ documentId: 'id', requestBody: { requests } });
    expect(out).toContain('2 request(s) applied');
    expect(out).toContain('occurrencesChanged');
  });
});
