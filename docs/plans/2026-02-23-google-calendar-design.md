# Google Calendar Support — Design

## Goal

Add full CRUD Google Calendar tools to the existing MCP server, following established patterns.

## Architecture

New file `src/tools/calendar.ts` with exported business functions and `registerCalendarTools()`, registered in `index.ts`. Uses Google Calendar API v3 via `googleapis`.

## Auth

Add `https://www.googleapis.com/auth/calendar` to SCOPES in `auth.ts`. Users must re-authorize after upgrading (delete tokens.json, run authorize tool).

## Tools

| Tool | Description |
|------|-------------|
| `calendar_list` | List all calendars the user has access to |
| `calendar_events` | List upcoming events (timeMin/timeMax filters, calendarId) |
| `calendar_search` | Search events by text query |
| `calendar_get` | Get full details of a specific event |
| `calendar_create` | Create event (summary, start, end, description, attendees, location) |
| `calendar_update` | Update existing event fields |
| `calendar_delete` | Delete an event |

## Security

- try/catch with `isError: true` on all handlers
- Input length limits via Zod (summary: 500, description: 5000, query: 500)
- Untrusted content markers on event read outputs
- Zod validation on all inputs

## Testing

Mocked `googleapis` calendar client, same vitest pattern as drive/docs/sheets test files.
