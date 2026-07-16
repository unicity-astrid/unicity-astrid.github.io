---
title: HTTP authentication and pairing
description: Redeem invites, refresh sessions, pair devices, and preserve principal identity at the edge.
part: HTTP API
order: 135
---

The gateway uses bearer sessions. A one-time invite or pairing code establishes
a session; subsequent requests carry the token in the `Authorization` header.
Tokens are credentials: keep them out of URLs, logs, browser persistence you do
not control, and capsule payloads.

## Complete authentication surface

| Method | Path | Auth | Contract |
| --- | --- | --- | --- |
| `POST` | `/api/auth/redeem` | public | redeem an invite code and device public key for a session |
| `GET` | `/api/auth/me` | bearer | return the current session and principal identity |
| `POST` | `/api/auth/refresh` | bearer | rotate or extend the authenticated session |
| `POST` | `/api/auth/pair-device` | bearer | issue a short-lived pairing request for another device |
| `POST` | `/api/auth/pair-device/redeem` | public | redeem the pairing request using the new device key |

The deployed OpenAPI schemas are named `RedeemRequest`, `RedeemResponse`,
`MeResponse`, `RefreshResponse`, `PairDeviceIssueRequest`,
`PairDeviceRedeemRequest`, and `PairDeviceRedeemResponse`.

## Redeem an invite

An operator creates an invite through the administration API. The client
generates or selects its device key, then posts the one-time code to
`/api/auth/redeem`. Successful redemption returns the session material and the
principal the invite authorizes.

```sh
curl --fail-with-body \
  -H 'content-type: application/json' \
  -d @redeem.json \
  http://127.0.0.1:2787/api/auth/redeem
```

Do not build a client that supplies an arbitrary principal ID after redemption.
The gateway attaches the authenticated principal to request extensions and the
runtime stamps it on downstream operations.

## Use the bearer

```sh
curl --fail-with-body \
  -H "authorization: Bearer $AOS_TOKEN" \
  http://127.0.0.1:2787/api/auth/me
```

Treat `401` as an invalid or expired session. Treat `403` as an authenticated
session that lacks authority for the requested operation. Do not retry either in
a tight loop.

## Pair a device

Pairing lets an authenticated principal add a second device without copying an
existing private key. The first device issues a short-lived pairing request; the
second redeems it with its own public key. The private key never crosses the
gateway.

Administrators can inspect and revoke devices through:

| Method | Path |
| --- | --- |
| `GET` | `/api/sys/principals/{id}/devices` |
| `DELETE` | `/api/sys/principals/{id}/devices/{key_id}` |

Revocation must invalidate future authentication from that device. A client
should surface the key ID and creation metadata from `DeviceKeyInfoView` so an
operator can identify the correct device without exposing key material.
