import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFilesList = vi.fn();
const mockFilesGet = vi.fn();
const mockFilesCreate = vi.fn();
const mockFilesUpdate = vi.fn();
const mockFilesDelete = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn().mockReturnValue({
      files: {
        list: mockFilesList,
        get: mockFilesGet,
        create: mockFilesCreate,
        update: mockFilesUpdate,
        delete: mockFilesDelete,
      },
    }),
  },
}));

vi.mock('../../src/auth.js', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({ /* mock oauth client */ }),
}));

const { listFiles, getFile, createFolder, moveFile, deleteFile, searchFiles } =
  await import('../../src/tools/drive.js');

describe('drive tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listFiles returns formatted file names', async () => {
    mockFilesList.mockResolvedValue({
      data: { files: [{ id: '1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet' }] },
    });
    const result = await listFiles();
    expect(result).toContain('Budget');
    expect(result).toContain('1');
  });

  it('listFiles returns "No files found" when empty', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    const result = await listFiles();
    expect(result).toBe('No files found.');
  });

  it('getFile returns file metadata', async () => {
    mockFilesGet.mockResolvedValue({
      data: { id: '1', name: 'Budget', mimeType: 'spreadsheet', modifiedTime: '2026-01-01' },
    });
    const result = await getFile('1');
    expect(result).toContain('Budget');
  });

  it('createFolder returns new folder id', async () => {
    mockFilesCreate.mockResolvedValue({ data: { id: 'folder-1', name: 'My Folder' } });
    const result = await createFolder('My Folder');
    expect(result).toContain('folder-1');
  });

  it('searchFiles returns matching files', async () => {
    mockFilesList.mockResolvedValue({
      data: { files: [{ id: '2', name: 'Q1 Report', mimeType: 'application/vnd.google-apps.document' }] },
    });
    const result = await searchFiles('Q1');
    expect(result).toContain('Q1 Report');
  });
});
