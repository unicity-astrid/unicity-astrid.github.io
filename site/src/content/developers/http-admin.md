---
title: Administration API
description: Manage principals, capabilities, quotas, groups, invites, capsules, models, and runtime readiness.
part: HTTP API
order: 145
---

Administration routes require a bearer session and then apply capability checks
for the requested operation. Authentication alone does not make a caller an
administrator.

## Principals

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sys/principals` | list principal summaries |
| `POST` | `/api/sys/principals` | create a principal from `CreatePrincipalRequest` |
| `GET` | `/api/sys/principals/{id}` | read one principal |
| `PATCH` | `/api/sys/principals/{id}` | apply `ModifyPrincipalRequest` |
| `DELETE` | `/api/sys/principals/{id}` | delete a principal according to runtime policy |
| `POST` | `/api/sys/principals/{id}/enable` | enable execution |
| `POST` | `/api/sys/principals/{id}/disable` | disable execution |

IDs are path parameters validated by the server. A disabled principal remains an
identity and can retain records; clients should not present disable as delete.

## Capabilities and quotas

| Method | Path | Body or response |
| --- | --- | --- |
| `POST` | `/api/sys/principals/{id}/caps` | `GrantRequest` |
| `DELETE` | `/api/sys/principals/{id}/caps` | `RevokeRequest` |
| `GET` | `/api/sys/principals/{id}/quotas` | current limits |
| `PUT` | `/api/sys/principals/{id}/quotas` | replace supported quota values |
| `GET` | `/api/sys/principals/{id}/usage` | current metered usage |
| `GET` | `/api/sys/capabilities` | `CapabilityCatalogResponse` |

Capability grants narrow authority; they do not alter capsule code. Build
administrative UIs from the capability catalog instead of hard-coding labels.
Quota and usage are different: setting a limit does not reset consumed usage.

## Groups and invites

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sys/groups` | `GroupListResponse` |
| `POST` | `/api/sys/groups` | create with `CreateGroupRequest` |
| `PATCH` | `/api/sys/groups/{name}` | modify with `ModifyGroupRequest` |
| `DELETE` | `/api/sys/groups/{name}` | delete a group |
| `GET` | `/api/sys/invites` | list invite summaries |
| `POST` | `/api/sys/invites` | issue from `IssueRequest` |
| `DELETE` | `/api/sys/invites/{fingerprint}` | revoke an unused invite |

Invite list responses expose fingerprints and safe metadata, not reusable
secret material. Show a newly issued code once, then store only what the schema
permits.

## Capsules and environment

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/capsules` | installed capsule summaries |
| `POST` | `/api/capsules` | install from `InstallRequest` |
| `GET` | `/api/capsules/{id}` | `CapsuleDetail` |
| `GET` | `/api/capsules/{id}/topics` | declared publish and subscribe topics |
| `GET` | `/api/capsules/{id}/env` | typed `EnvSchemaResponse` |
| `POST` | `/api/capsules/{id}/env/{field}` | write one field with `EnvWriteRequest` |

Install accepts only sources allowed by product policy and verification. Do not
build a UI that turns an arbitrary URL into a trusted capsule. Environment
schemas mark request text, types, defaults, and secret handling; never echo a
secret value after writing it.

## Models and runtime

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/models` | list models discovered through the active provider registry |
| `GET` | `/api/models/active` | current model selection |
| `PUT` | `/api/models/active` | select with `SetActiveModelRequest` |
| `GET` | `/api/sys/status` | runtime status summary |
| `GET` | `/api/sys/readiness` | readiness and dependency checks |
| `POST` | `/api/sys/capsules/reload` | reload the install-time capsule set |

Model selection is a product operation delegated to capsules; the kernel does
not contain model policy. A reload is an administrative mutation and should be
followed by readiness checks before traffic resumes.

## Operations probes

`GET /healthz` and `GET /metrics` are public to support load balancers and
Prometheus. “Public” means no bearer middleware, not safe for the open internet.
Restrict them with the reverse proxy or firewall. The separate AOS
`/v1/runtime/health` loopback projection remains intentionally narrower.
