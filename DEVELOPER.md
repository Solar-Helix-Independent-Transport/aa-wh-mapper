# Developer Notes

Notes for developers extending aa-wh-mapper or integrating another AllianceAuth app with it. For install/setup instructions see [README.md](README.md).

## Signals

### `wh_mapper.signals.map_changed`

A `django.dispatch.Signal` fired on every map mutation, decoupled from the websocket broadcast that already fans mutations out to connected clients (`wh_mapper.broadcast.broadcast_map_event`). Use it to react to map changes from your own code or a third-party app without depending on the websocket layer.

It fires once per call to `broadcast_map_event`, which covers every map-mutating endpoint in the app (connections, signatures, flags, tracking, regions, systems) and background task that touches a map — regardless of whether a channel layer is configured.

**Kwargs:**

| Name     | Type           | Description                                                                                                                                                                                        |
| -------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map_id` | `int`          | The `Map` row the mutation applies to.                                                                                                                                                             |
| `event`  | `str`          | The event name, e.g. `"system.added"`, `"connection.updated"`.                                                                                                                                     |
| `data`   | `dict`         | The event payload — the same dict sent to connected websocket clients.                                                                                                                             |
| `user`   | `User \| None` | Whoever triggered the mutation, or `None` for a system-driven one with no real actor (life/mass aging, the eve-scout sync). Never part of `data`/the websocket payload — only reaches this signal. |

`sender` is always the `Map` model class.

**Event types:**

| Event                     | Fired when...                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `system.added`            | A system is added to a map.                                                                                          |
| `system.updated`          | A system's fields (name, position, owner, etc.) change.                                                              |
| `system.removed`          | A system is removed from a map.                                                                                      |
| `connection.added`        | A wormhole/stargate/ansiblex connection is drawn.                                                                    |
| `connection.updated`      | A connection's life/mass status or other fields change.                                                              |
| `connection.removed`      | A connection is deleted (manually, or aged out).                                                                     |
| `signature.added`         | A signature is added to a system.                                                                                    |
| `signature.updated`       | A signature's fields change.                                                                                         |
| `signature.removed`       | A signature is deleted.                                                                                              |
| `signature.bulk_upserted` | A signature scan paste is imported (adds/updates many signatures at once).                                           |
| `character.moved`         | A tracked character's location changes.                                                                              |
| `character.removed`       | A tracked character stops being tracked.                                                                             |
| `map.resync`              | A change is broad enough (e.g. a region import) that clients should refetch the whole map rather than apply a delta. |

`character.jump_needs_signature` also exists on the websocket layer (sent when a tracked character jumps into a system needing a signature) but is delivered only to the character's own owner via `send_map_event_to_user`, which does **not** go through `broadcast_map_event` — so it does **not** fire `map_changed`.

**`user` isn't always the person who clicked something.** For `character.moved`/`character.removed`/the `system.added`/`connection.added` pair raised by a character auto-growing a map as it jumps, `user` is the tracked character's owner (`TrackedCharacter.added_by`) — the mutation is ESI-poll-driven, not a direct action by that user in that moment. For a fleet-mass-crossing `connection.updated`, it's the fleet tracking session's `started_by` (the FC), not the fleet member whose ship actually crossed. `user` is `None` only for the handful of genuinely system-driven mutations: life/mass aging and the eve-scout sync.

**Example:**

```python
from django.dispatch import receiver
from wh_mapper.signals import map_changed


@receiver(map_changed)
def on_map_changed(sender, map_id, event, data, user, **kwargs): ...
```

Connect your receiver from your app's `AppConfig.ready()` (see the `allianceauth-app-dev` skill's guidance on wiring `signals.py`). Wrap the receiver body in `try`/`except` — it runs synchronously inside the request/task that triggered the mutation.
