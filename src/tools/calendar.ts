import { google } from 'googleapis';
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
