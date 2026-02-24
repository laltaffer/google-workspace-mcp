# Google Calendar Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full CRUD Google Calendar tools to the existing MCP server.

**Architecture:** New `src/tools/calendar.ts` following the same pattern as drive/docs/sheets — private client factory, exported business functions, `registerCalendarTools()` wired into `index.ts`. One new OAuth scope in `auth.ts`. Tests in `tests/tools/calendar.test.ts`.

**Tech Stack:** TypeScript, googleapis (Calendar API v3), zod, vitest, @modelcontextprotocol/sdk

---

### Task 1: Add Calendar OAuth scope

**Files:**
- Modify: `src/auth.ts:15-19`

**Step 1: Add the calendar scope**

In `src/auth.ts`, add `'https://www.googleapis.com/auth/calendar'` to the SCOPES array:

```typescript
const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
];
```

**Step 2: Run existing tests to verify no regressions**

Run: `npm test`
Expected: All 19 tests pass.

**Step 3: Commit**

```bash
git add src/auth.ts
git commit -m "feat: add Google Calendar OAuth scope"
```

---

### Task 2: Create calendar.ts with listCalendars and listEvents

**Files:**
- Create: `src/tools/calendar.ts`
- Create: `tests/tools/calendar.test.ts`

**Step 1: Write the test file with tests for listCalendars and listEvents**

Create `tests/tools/calendar.test.ts`:

```typescript
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

const { listCalendars, listEvents } =
  await import('../../src/tools/calendar.js');

describe('calendar tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listCalendars returns formatted calendar list', async () => {
    mockCalendarListList.mockResolvedValue({
      data: {
        items: [
          { id: 'primary', summary: 'My Calendar', primary: true },
          { id: 'work@group.calendar.google.com', summary: 'Work' },
        ],
      },
    });
    const result = await listCalendars();
    expect(result).toContain('My Calendar');
    expect(result).toContain('Work');
    expect(result).toContain('primary');
  });

  it('listCalendars returns empty message when no calendars', async () => {
    mockCalendarListList.mockResolvedValue({ data: { items: [] } });
    const result = await listCalendars();
    expect(result).toContain('No calendars');
  });

  it('listEvents returns formatted events', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt1',
          summary: 'Team Standup',
          start: { dateTime: '2026-02-23T09:00:00Z' },
          end: { dateTime: '2026-02-23T09:30:00Z' },
        }],
      },
    });
    const result = await listEvents('primary');
    expect(result).toContain('Team Standup');
    expect(result).toContain('evt1');
  });

  it('listEvents returns empty message when no events', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    const result = await listEvents('primary');
    expect(result).toContain('No events');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../../src/tools/calendar.js`

**Step 3: Create calendar.ts with listCalendars and listEvents**

Create `src/tools/calendar.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';

async function getCalendarClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.calendar({ version: 'v3', auth });
}

export async function listCalendars(): Promise<string> {
  const cal = await getCalendarClient();
  const res = await cal.calendarList.list({ fields: 'items(id,summary,primary)' });
  const items = res.data.items ?? [];
  if (items.length === 0) return 'No calendars found.';
  return items.map(c => `${c.summary}${c.primary ? ' (primary)' : ''} | id: ${c.id}`).join('\n');
}

export async function listEvents(
  calendarId: string,
  timeMin?: string,
  timeMax?: string,
  maxResults = 20,
): Promise<string> {
  const cal = await getCalendarClient();
  const clampedMax = Math.min(Math.max(maxResults, 1), 100);
  const res = await cal.events.list({
    calendarId,
    timeMin: timeMin ?? new Date().toISOString(),
    timeMax,
    maxResults: clampedMax,
    singleEvents: true,
    orderBy: 'startTime',
    fields: 'items(id,summary,start,end,location,status)',
  });
  const events = res.data.items ?? [];
  if (events.length === 0) return 'No events found.';
  return `[UNTRUSTED CALENDAR CONTENT BELOW]\n${events.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? 'unknown';
    const end = e.end?.dateTime ?? e.end?.date ?? '';
    return `${e.summary ?? '(no title)'} | ${start} → ${end} | id: ${e.id}`;
  }).join('\n')}\n[END UNTRUSTED CALENDAR CONTENT]`;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass (19 existing + 4 new = 23).

**Step 5: Commit**

```bash
git add src/tools/calendar.ts tests/tools/calendar.test.ts
git commit -m "feat: add calendar listCalendars and listEvents"
```

---

### Task 3: Add searchEvents and getEvent

**Files:**
- Modify: `src/tools/calendar.ts`
- Modify: `tests/tools/calendar.test.ts`

**Step 1: Add tests for searchEvents and getEvent**

Append to the `describe` block in `tests/tools/calendar.test.ts`:

```typescript
  it('searchEvents returns matching events', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt2',
          summary: 'Budget Review',
          start: { dateTime: '2026-03-01T14:00:00Z' },
          end: { dateTime: '2026-03-01T15:00:00Z' },
        }],
      },
    });
    const result = await searchEvents('primary', 'Budget');
    expect(result).toContain('Budget Review');
  });

  it('getEvent returns event details', async () => {
    mockEventsGet.mockResolvedValue({
      data: {
        id: 'evt1',
        summary: 'Team Standup',
        start: { dateTime: '2026-02-23T09:00:00Z' },
        end: { dateTime: '2026-02-23T09:30:00Z' },
        location: 'Room 42',
        description: 'Daily sync',
        attendees: [{ email: 'alice@example.com', responseStatus: 'accepted' }],
      },
    });
    const result = await getEvent('primary', 'evt1');
    expect(result).toContain('Team Standup');
    expect(result).toContain('Room 42');
    expect(result).toContain('alice@example.com');
  });
```

Update the import to also import `searchEvents` and `getEvent`:

```typescript
const { listCalendars, listEvents, searchEvents, getEvent } =
  await import('../../src/tools/calendar.js');
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `searchEvents` and `getEvent` are not exported.

**Step 3: Add searchEvents and getEvent to calendar.ts**

Append to `src/tools/calendar.ts` (before any `registerCalendarTools` if it exists, or at the end):

```typescript
export async function searchEvents(
  calendarId: string,
  query: string,
  timeMin?: string,
  timeMax?: string,
  maxResults = 20,
): Promise<string> {
  const cal = await getCalendarClient();
  const clampedMax = Math.min(Math.max(maxResults, 1), 100);
  const res = await cal.events.list({
    calendarId,
    q: query,
    timeMin: timeMin ?? new Date().toISOString(),
    timeMax,
    maxResults: clampedMax,
    singleEvents: true,
    orderBy: 'startTime',
    fields: 'items(id,summary,start,end,location,status)',
  });
  const events = res.data.items ?? [];
  if (events.length === 0) return 'No events found matching that query.';
  return `[UNTRUSTED CALENDAR CONTENT BELOW]\n${events.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? 'unknown';
    const end = e.end?.dateTime ?? e.end?.date ?? '';
    return `${e.summary ?? '(no title)'} | ${start} → ${end} | id: ${e.id}`;
  }).join('\n')}\n[END UNTRUSTED CALENDAR CONTENT]`;
}

export async function getEvent(calendarId: string, eventId: string): Promise<string> {
  const cal = await getCalendarClient();
  const res = await cal.events.get({
    calendarId,
    eventId,
    fields: 'id,summary,start,end,location,description,attendees,status,htmlLink',
  });
  const e = res.data;
  const start = e.start?.dateTime ?? e.start?.date ?? 'unknown';
  const end = e.end?.dateTime ?? e.end?.date ?? '';
  const attendees = e.attendees?.map(a => `${a.email} (${a.responseStatus})`).join(', ') ?? 'none';
  return `[UNTRUSTED CALENDAR CONTENT BELOW]\nSummary: ${e.summary ?? '(no title)'}\nWhen: ${start} → ${end}\nLocation: ${e.location ?? 'none'}\nDescription: ${e.description ?? 'none'}\nAttendees: ${attendees}\nStatus: ${e.status}\nLink: ${e.htmlLink}\nID: ${e.id}\n[END UNTRUSTED CALENDAR CONTENT]`;
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass (25 total).

**Step 5: Commit**

```bash
git add src/tools/calendar.ts tests/tools/calendar.test.ts
git commit -m "feat: add calendar searchEvents and getEvent"
```

---

### Task 4: Add createEvent, updateEvent, deleteEvent

**Files:**
- Modify: `src/tools/calendar.ts`
- Modify: `tests/tools/calendar.test.ts`

**Step 1: Add tests for createEvent, updateEvent, deleteEvent**

Append to the `describe` block in `tests/tools/calendar.test.ts`:

```typescript
  it('createEvent returns new event id and summary', async () => {
    mockEventsInsert.mockResolvedValue({
      data: { id: 'new-evt-1', summary: 'Lunch', htmlLink: 'https://calendar.google.com/event?eid=abc' },
    });
    const result = await createEvent('primary', {
      summary: 'Lunch',
      start: '2026-03-01T12:00:00Z',
      end: '2026-03-01T13:00:00Z',
    });
    expect(result).toContain('new-evt-1');
    expect(result).toContain('Lunch');
  });

  it('updateEvent returns updated event info', async () => {
    mockEventsPatch.mockResolvedValue({
      data: { id: 'evt1', summary: 'Updated Standup' },
    });
    const result = await updateEvent('primary', 'evt1', { summary: 'Updated Standup' });
    expect(result).toContain('Updated Standup');
  });

  it('deleteEvent returns confirmation', async () => {
    mockEventsDelete.mockResolvedValue({});
    const result = await deleteEvent('primary', 'evt1');
    expect(result).toContain('evt1');
    expect(result).toContain('deleted');
  });
```

Update the import:

```typescript
const { listCalendars, listEvents, searchEvents, getEvent, createEvent, updateEvent, deleteEvent } =
  await import('../../src/tools/calendar.js');
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `createEvent`, `updateEvent`, `deleteEvent` not exported.

**Step 3: Add createEvent, updateEvent, deleteEvent to calendar.ts**

Append to `src/tools/calendar.ts`:

```typescript
interface EventInput {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
}

export async function createEvent(calendarId: string, input: EventInput): Promise<string> {
  const cal = await getCalendarClient();
  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: input.summary,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
      description: input.description,
      location: input.location,
      attendees: input.attendees?.map(email => ({ email })),
    },
  });
  return `Event created: "${res.data.summary}" | id: ${res.data.id} | link: ${res.data.htmlLink}`;
}

interface EventUpdate {
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  updates: EventUpdate,
): Promise<string> {
  const cal = await getCalendarClient();
  const requestBody: Record<string, unknown> = {};
  if (updates.summary !== undefined) requestBody.summary = updates.summary;
  if (updates.description !== undefined) requestBody.description = updates.description;
  if (updates.location !== undefined) requestBody.location = updates.location;
  if (updates.start !== undefined) requestBody.start = { dateTime: updates.start };
  if (updates.end !== undefined) requestBody.end = { dateTime: updates.end };
  const res = await cal.events.patch({ calendarId, eventId, requestBody });
  return `Event updated: "${res.data.summary}" | id: ${res.data.id}`;
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<string> {
  const cal = await getCalendarClient();
  await cal.events.delete({ calendarId, eventId });
  return `Event ${eventId} deleted.`;
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass (28 total).

**Step 5: Commit**

```bash
git add src/tools/calendar.ts tests/tools/calendar.test.ts
git commit -m "feat: add calendar createEvent, updateEvent, deleteEvent"
```

---

### Task 5: Add registerCalendarTools and wire into index.ts

**Files:**
- Modify: `src/tools/calendar.ts`
- Modify: `src/index.ts:3,6,32`

**Step 1: Add registerCalendarTools to calendar.ts**

Append to `src/tools/calendar.ts`:

```typescript
export function registerCalendarTools(server: McpServer): void {
  server.registerTool('calendar_list', {
    description: 'List all Google Calendars the user has access to',
    inputSchema: {},
  }, async () => {
    try {
      return { content: [{ type: 'text', text: await listCalendars() }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error listing calendars: ${msg}` }], isError: true };
    }
  });

  server.registerTool('calendar_events', {
    description: 'List upcoming events from a Google Calendar',
    inputSchema: {
      calendarId: z.string().optional().describe('Calendar ID (defaults to "primary")'),
      timeMin: z.string().optional().describe('Start of time range (ISO 8601, defaults to now)'),
      timeMax: z.string().optional().describe('End of time range (ISO 8601)'),
      maxResults: z.number().int().min(1).max(100).optional().describe('Max events to return (default 20, max 100)'),
    },
  }, async ({ calendarId, timeMin, timeMax, maxResults }) => {
    try {
      return { content: [{ type: 'text', text: await listEvents(calendarId ?? 'primary', timeMin, timeMax, maxResults) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error listing events: ${msg}` }], isError: true };
    }
  });

  server.registerTool('calendar_search', {
    description: 'Search for events in a Google Calendar by text query',
    inputSchema: {
      query: z.string().max(500).describe('Search term to match against event text'),
      calendarId: z.string().optional().describe('Calendar ID (defaults to "primary")'),
      timeMin: z.string().optional().describe('Start of time range (ISO 8601, defaults to now)'),
      timeMax: z.string().optional().describe('End of time range (ISO 8601)'),
      maxResults: z.number().int().min(1).max(100).optional().describe('Max events (default 20, max 100)'),
    },
  }, async ({ query, calendarId, timeMin, timeMax, maxResults }) => {
    try {
      return { content: [{ type: 'text', text: await searchEvents(calendarId ?? 'primary', query, timeMin, timeMax, maxResults) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error searching events: ${msg}` }], isError: true };
    }
  });

  server.registerTool('calendar_get', {
    description: 'Get full details of a specific calendar event',
    inputSchema: {
      eventId: z.string().describe('The event ID'),
      calendarId: z.string().optional().describe('Calendar ID (defaults to "primary")'),
    },
  }, async ({ eventId, calendarId }) => {
    try {
      return { content: [{ type: 'text', text: await getEvent(calendarId ?? 'primary', eventId) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error getting event: ${msg}` }], isError: true };
    }
  });

  server.registerTool('calendar_create', {
    description: 'Create a new event in a Google Calendar',
    inputSchema: {
      summary: z.string().max(500).describe('Event title'),
      start: z.string().describe('Start time (ISO 8601, e.g. "2026-03-01T09:00:00-05:00")'),
      end: z.string().describe('End time (ISO 8601)'),
      description: z.string().max(5000).optional().describe('Event description'),
      location: z.string().max(500).optional().describe('Event location'),
      attendees: z.array(z.string().email()).optional().describe('List of attendee email addresses'),
      calendarId: z.string().optional().describe('Calendar ID (defaults to "primary")'),
    },
  }, async ({ summary, start, end, description, location, attendees, calendarId }) => {
    try {
      return { content: [{ type: 'text', text: await createEvent(calendarId ?? 'primary', { summary, start, end, description, location, attendees }) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error creating event: ${msg}` }], isError: true };
    }
  });

  server.registerTool('calendar_update', {
    description: 'Update an existing event in a Google Calendar',
    inputSchema: {
      eventId: z.string().describe('The event ID to update'),
      summary: z.string().max(500).optional().describe('New event title'),
      start: z.string().optional().describe('New start time (ISO 8601)'),
      end: z.string().optional().describe('New end time (ISO 8601)'),
      description: z.string().max(5000).optional().describe('New description'),
      location: z.string().max(500).optional().describe('New location'),
      calendarId: z.string().optional().describe('Calendar ID (defaults to "primary")'),
    },
  }, async ({ eventId, summary, start, end, description, location, calendarId }) => {
    try {
      return { content: [{ type: 'text', text: await updateEvent(calendarId ?? 'primary', eventId, { summary, start, end, description, location }) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error updating event: ${msg}` }], isError: true };
    }
  });

  server.registerTool('calendar_delete', {
    description: 'Delete an event from a Google Calendar',
    inputSchema: {
      eventId: z.string().describe('The event ID to delete'),
      calendarId: z.string().optional().describe('Calendar ID (defaults to "primary")'),
    },
  }, async ({ eventId, calendarId }) => {
    try {
      return { content: [{ type: 'text', text: await deleteEvent(calendarId ?? 'primary', eventId) }] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error deleting event: ${msg}` }], isError: true };
    }
  });
}
```

**Step 2: Wire into index.ts**

Add import at line 6 of `src/index.ts`:

```typescript
import { registerCalendarTools } from './tools/calendar.js';
```

Add registration after the existing tools (after line 32):

```typescript
registerCalendarTools(server);
```

**Step 3: Build and run all tests**

Run: `npm run build && npm test`
Expected: Build succeeds. All 28 tests pass.

**Step 4: Commit**

```bash
git add src/tools/calendar.ts src/index.ts
git commit -m "feat: register all calendar tools in MCP server"
```

---

### Task 6: Update README and enable Calendar API

**Files:**
- Modify: `README.md`

**Step 1: Update README**

Add Calendar section to Features (after Google Drive section). Update tool count from 17 to 24:

```markdown
**Google Calendar**
- `calendar_list` — List all calendars
- `calendar_events` — List upcoming events
- `calendar_search` — Search events by text
- `calendar_get` — Get full event details
- `calendar_create` — Create a new event
- `calendar_update` — Update an existing event
- `calendar_delete` — Delete an event
```

Add to the "Enable the following APIs" section:

```markdown
- [Google Calendar API](https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com)
```

Add a note in the Authorize section about re-authorization:

```markdown
> **Upgrading?** If you previously authorized without Calendar support, delete `~/.google-workspace-mcp/tokens.json` and re-authorize to grant calendar permissions.
```

**Step 2: Build, test, commit, push**

Run: `npm run build && npm test`
Expected: Build succeeds. All 28 tests pass.

```bash
git add README.md
git commit -m "docs: add Google Calendar to README"
git push
```
