---
title: IPC topics and request flow
description: Design typed event-bus contracts, authorization boundaries, timeouts, and fan-out behavior.
part: Build capsules
order: 50
---

Capsules communicate over the runtime event bus. Topic names provide routing;
WIT types provide payload contracts; manifest ACLs provide intent; the kernel
stamps the caller identity used for authorization.

## Name topics as contracts

Use a versioned namespace and make direction obvious:

```text
example.v1.request.run
example.v1.response.run
example.v1.event.changed
```

Changing a payload incompatibly requires a new contract version. Do not smuggle
an unrelated operation through a generic JSON topic merely to avoid defining a
contract.

## Request and response

The caller subscribes to a response topic before publishing the request. The
request carries a correlation or response topic when the contract calls for it.
The callee validates the payload and explicitly publishes its answer.

```rust
let response_topic = "example.v1.response.run.7f2a";
let subscription = ipc::subscribe(response_topic)?;
ipc::publish_json(
    "example.v1.request.run",
    &serde_json::json!({ "response_topic": response_topic, "input": "hello" }),
)?;
let result = subscription.recv(10_000)?;
let message = result
    .messages
    .iter()
    .find(|message| message.topic == response_topic)
    .ok_or_else(|| SysError::ApiError("response topic was not received".into()))?;
```

That correlated form requires the callee's manifest to allow
`example.v1.response.run.*`. If the contract has one fixed response topic, use
that exact topic instead and keep the publish ACL concrete.

`recv` accepts a timeout in milliseconds. A timeout is returned as a host error;
on success, inspect the `PollResult` rather than assuming it contains exactly one
message. Validate the selected message's topic and payload, and account for its
`dropped` and `lagged` counters before using it.

## Caller identity

Never authorize from `principal_id`, `user_id`, or similar fields supplied by
the payload. Those fields may be useful application data, but the authority is
the caller and principal stamped by the runtime on the envelope.

For multi-user uplinks, resolve the platform account at the product edge and
carry the runtime identity through the authenticated connection. A capsule must
not let a caller select a different principal in an ordinary request body.

## Fan-out and hooks

An interceptor return value is not automatically broadcast. When multiple
subscribers contribute to a prompt, tool catalog, or policy decision, define a
response topic and have each contributor publish its typed contribution.

Decide how the coordinator handles:

- zero responses;
- duplicate responders;
- a late response after the deadline;
- a responder that returns invalid data;
- deterministic ordering and merge conflicts.

Those are product semantics and belong in the coordinating capsule, not in the
kernel router.

## Avoid bus deadlocks

Do not hold mutable state across a blocking request to another capsule. Keep
handlers re-entrant where practical, bound request deadlines, and make retries
idempotent. Include a correlation ID in logs and terminal errors, but never log
bearer tokens or secret fields.
