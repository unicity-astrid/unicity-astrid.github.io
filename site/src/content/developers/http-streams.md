---
title: Agent and event streams
description: Submit prompts, consume SSE, answer approvals and elicitations, and manage conversation sessions.
part: HTTP API
order: 140
---

The agent surface is asynchronous. A prompt starts work and streams status; live
feeds carry deltas and requests; separate response routes answer approvals and
structured elicitations.

## Complete agent surface

| Method | Path | Response |
| --- | --- | --- |
| `POST` | `/api/agent/prompt` | SSE prompt lifecycle and output |
| `GET` | `/api/agent/requests` | SSE pending approval and elicitation requests |
| `GET` | `/api/agent/stream` | SSE live conversation feed for the authenticated principal |
| `POST` | `/api/agent/elicit-response` | JSON acknowledgement |
| `POST` | `/api/agent/approval-response` | JSON acknowledgement |

`PromptRequest` identifies the prompt and conversation context. The server emits
a `PromptReady` event once the request has been accepted. Request IDs for
approval and elicitation responses are UUID strings; clients must echo the ID
they received rather than inventing one.

## Consume Server-Sent Events

Send `Accept: text/event-stream`, parse frames incrementally, and dispatch on
the event name. A frame can be split across transport reads; never parse SSE by
splitting individual network chunks on blank lines.

```sh
curl --no-buffer --fail-with-body \
  -H "authorization: Bearer $AOS_TOKEN" \
  -H 'accept: text/event-stream' \
  -H 'content-type: application/json' \
  -d @prompt.json \
  http://127.0.0.1:2787/api/agent/prompt
```

The live conversation feed begins with a readiness event (`FeedReady`) so a
client knows its subscription is active. Preserve event IDs if the deployed
contract supplies them and use bounded reconnect backoff. Do not replay a prompt
merely because the stream disconnected; first reconcile the session transcript.

## Approval and elicitation

An approval asks whether a constrained operation may proceed. An elicitation
asks for structured user input. Render them as distinct UI states and validate
the response against the request schema.

The response request bodies are `ApprovalResponseRequest` and
`ElicitResponseRequest`. They include the server-issued request ID and the user's
decision or structured value. The authenticated principal must match the
pending request; callers cannot answer on behalf of another principal by placing
its ID in JSON.

## Conversation sessions

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/agent/sessions` | paginated session summaries |
| `GET` | `/api/agent/sessions/search` | search session text and metadata |
| `GET` | `/api/agent/sessions/{id}` | one session summary |
| `PATCH` | `/api/agent/sessions/{id}` | rename, archive, or update supported metadata |
| `DELETE` | `/api/agent/sessions/{id}` | delete the session |
| `GET` | `/api/agent/sessions/{id}/messages` | transcript messages |

Session IDs are non-empty, at most 256 characters, and contain no ASCII control
characters. Encode path segments and query values correctly. `search` is a
static route, not a session ID.

List and search parameters are defined by `SessionListQuery` and `SearchQuery`.
Responses use `SessionListResponse`, `TranscriptResponse`, `SearchResponse`, and
`DeleteResponse`. Respect server pagination and do not assume an unbounded list.

## Event and audit feeds

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/events` | SSE live runtime event stream for the authenticated principal |
| `GET` | `/api/sys/audit` | paginated runtime audit history |

Runtime audit records are not the same product as Unicity Audit on the Unicity
blockchain; an AOS integration between them requires an explicit product contract.
