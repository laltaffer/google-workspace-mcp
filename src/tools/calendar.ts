import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { google } from 'googleapis';
import { z } from 'zod';
import { getAuthenticatedClient } from '../auth.js';

export interface EventInput {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: string[];
}

export interface EventUpdate {
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
}

async function getCalendarClient() {
  const auth = await getAuthenticatedClient();
  if (!auth) throw new Error('Not authenticated. Call the authorize tool first.');
  return google.calendar({ version: 'v3', auth });
}

export async function listCalendars(): Promise<string> {
  const cal = await getCalendarClient();
  const res = await cal.calendarList.list({
    fields: 'items(id,summary,primary)',
  });
  const items = res.data.items ?? [];
  if (items.length === 0) return 'No calendars found.';
  return items
    .map(c => `${c.summary}${c.primary ? ' (primary)' : ''} | id: ${c.id}`)
    .join('\n');
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
  const lines = events.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? '';
    const end = e.end?.dateTime ?? e.end?.date ?? '';
    return `${e.summary} | ${start} → ${end} | id: ${e.id}`;
  });
  return `[UNTRUSTED CALENDAR CONTENT BELOW]\n${lines.join('\n')}\n[END UNTRUSTED CALENDAR CONTENT]`;
}

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
  const lines = events.map(e => {
    const start = e.start?.dateTime ?? e.start?.date ?? '';
    const end = e.end?.dateTime ?? e.end?.date ?? '';
    return `${e.summary} | ${start} → ${end} | id: ${e.id}`;
  });
  return `[UNTRUSTED CALENDAR CONTENT BELOW]\n${lines.join('\n')}\n[END UNTRUSTED CALENDAR CONTENT]`;
}

export async function getEvent(calendarId: string, eventId: string): Promise<string> {
  const cal = await getCalendarClient();
  const res = await cal.events.get({
    calendarId,
    eventId,
    fields: 'id,summary,start,end,location,description,attendees,status,htmlLink',
  });
  const e = res.data;
  const start = e.start?.dateTime ?? e.start?.date ?? '';
  const end = e.end?.dateTime ?? e.end?.date ?? '';
  const parts = [
    `Summary: ${e.summary}`,
    `Start: ${start}`,
    `End: ${end}`,
    `Status: ${e.status}`,
    `Location: ${e.location ?? 'N/A'}`,
    `Description: ${e.description ?? 'N/A'}`,
    `Link: ${e.htmlLink}`,
    `ID: ${e.id}`,
  ];
  if (e.attendees && e.attendees.length > 0) {
    const list = e.attendees.map(a => `${a.email} (${a.responseStatus})`).join(', ');
    parts.push(`Attendees: ${list}`);
  }
  return `[UNTRUSTED CALENDAR CONTENT BELOW]\n${parts.join('\n')}\n[END UNTRUSTED CALENDAR CONTENT]`;
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
    fields: 'id,summary,htmlLink',
  });
  return `Event created: "${res.data.summary}" | id: ${res.data.id} | link: ${res.data.htmlLink}`;
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
  const res = await cal.events.patch({
    calendarId,
    eventId,
    requestBody,
    fields: 'id,summary',
  });
  return `Event updated: "${res.data.summary}" | id: ${res.data.id}`;
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<string> {
  const cal = await getCalendarClient();
  await cal.events.delete({ calendarId, eventId });
  return `Event ${eventId} deleted.`;
}

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
