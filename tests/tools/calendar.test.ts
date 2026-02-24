import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCalendarListList = vi.fn();
const mockEventsList = vi.fn();
const mockEventsGet = vi.fn();
const mockEventsInsert = vi.fn();
const mockEventsPatch = vi.fn();
const mockEventsDelete = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn().mockReturnValue({
      calendarList: { list: mockCalendarListList },
      events: {
        list: mockEventsList,
        get: mockEventsGet,
        insert: mockEventsInsert,
        patch: mockEventsPatch,
        delete: mockEventsDelete,
      },
    }),
  },
}));

vi.mock('../../src/auth.js', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({}),
}));

const {
  listCalendars,
  listEvents,
  searchEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
} = await import('../../src/tools/calendar.js');

describe('calendar tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listCalendars returns formatted list', async () => {
    mockCalendarListList.mockResolvedValue({
      data: {
        items: [
          { id: 'cal-1', summary: 'Work', primary: true },
          { id: 'cal-2', summary: 'Personal', primary: false },
        ],
      },
    });
    const result = await listCalendars();
    expect(result).toContain('Work (primary)');
    expect(result).toContain('id: cal-1');
    expect(result).toContain('Personal');
    expect(result).toContain('id: cal-2');
    expect(result).not.toContain('Personal (primary)');
  });

  it('listCalendars returns empty message', async () => {
    mockCalendarListList.mockResolvedValue({ data: { items: [] } });
    const result = await listCalendars();
    expect(result).toBe('No calendars found.');
  });

  it('listEvents returns formatted events', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt-1',
            summary: 'Team Standup',
            start: { dateTime: '2026-02-23T09:00:00Z' },
            end: { dateTime: '2026-02-23T09:30:00Z' },
          },
          {
            id: 'evt-2',
            summary: 'All-day Review',
            start: { date: '2026-02-24' },
            end: { date: '2026-02-25' },
          },
        ],
      },
    });
    const result = await listEvents('cal-1');
    expect(result).toContain('[UNTRUSTED CALENDAR CONTENT BELOW]');
    expect(result).toContain('Team Standup');
    expect(result).toContain('2026-02-23T09:00:00Z');
    expect(result).toContain('All-day Review');
    expect(result).toContain('2026-02-24');
    expect(result).toContain('[END UNTRUSTED CALENDAR CONTENT]');
  });

  it('listEvents returns empty message', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    const result = await listEvents('cal-1');
    expect(result).toBe('No events found.');
  });

  it('searchEvents returns matching events', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [
          {
            id: 'evt-3',
            summary: 'Budget Review',
            start: { dateTime: '2026-03-01T14:00:00Z' },
            end: { dateTime: '2026-03-01T15:00:00Z' },
          },
        ],
      },
    });
    const result = await searchEvents('cal-1', 'budget');
    expect(result).toContain('Budget Review');
    expect(result).toContain('id: evt-3');
    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'budget' }),
    );
  });

  it('searchEvents returns empty message when no matches', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    const result = await searchEvents('cal-1', 'nonexistent');
    expect(result).toBe('No events found matching that query.');
  });

  it('getEvent returns full event details with attendees', async () => {
    mockEventsGet.mockResolvedValue({
      data: {
        id: 'evt-1',
        summary: 'Planning Meeting',
        start: { dateTime: '2026-02-23T10:00:00Z' },
        end: { dateTime: '2026-02-23T11:00:00Z' },
        location: 'Room 42',
        description: 'Quarterly planning',
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/event?eid=abc',
        attendees: [
          { email: 'alice@example.com', responseStatus: 'accepted' },
          { email: 'bob@example.com', responseStatus: 'needsAction' },
        ],
      },
    });
    const result = await getEvent('cal-1', 'evt-1');
    expect(result).toContain('Planning Meeting');
    expect(result).toContain('Room 42');
    expect(result).toContain('Quarterly planning');
    expect(result).toContain('alice@example.com (accepted)');
    expect(result).toContain('bob@example.com (needsAction)');
    expect(result).toContain('[UNTRUSTED CALENDAR CONTENT BELOW]');
  });

  it('createEvent returns event id and summary', async () => {
    mockEventsInsert.mockResolvedValue({
      data: {
        id: 'new-evt-1',
        summary: 'Lunch',
        htmlLink: 'https://calendar.google.com/event?eid=xyz',
      },
    });
    const result = await createEvent('cal-1', {
      summary: 'Lunch',
      start: '2026-02-23T12:00:00Z',
      end: '2026-02-23T13:00:00Z',
      attendees: ['alice@example.com'],
    });
    expect(result).toContain('Event created: "Lunch"');
    expect(result).toContain('id: new-evt-1');
    expect(result).toContain('link: https://calendar.google.com/event?eid=xyz');
    expect(mockEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          attendees: [{ email: 'alice@example.com' }],
        }),
      }),
    );
  });

  it('updateEvent returns updated info', async () => {
    mockEventsPatch.mockResolvedValue({
      data: { id: 'evt-1', summary: 'Updated Meeting' },
    });
    const result = await updateEvent('cal-1', 'evt-1', {
      summary: 'Updated Meeting',
      start: '2026-02-23T11:00:00Z',
    });
    expect(result).toContain('Event updated: "Updated Meeting"');
    expect(result).toContain('id: evt-1');
    expect(mockEventsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          summary: 'Updated Meeting',
          start: { dateTime: '2026-02-23T11:00:00Z' },
        }),
      }),
    );
  });

  it('deleteEvent returns confirmation', async () => {
    mockEventsDelete.mockResolvedValue({});
    const result = await deleteEvent('cal-1', 'evt-1');
    expect(result).toBe('Event evt-1 deleted.');
    expect(mockEventsDelete).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'cal-1', eventId: 'evt-1' }),
    );
  });
});
