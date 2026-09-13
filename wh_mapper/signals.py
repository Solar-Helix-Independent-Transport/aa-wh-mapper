"""Django signals fired on map mutations, for other code (this app's own or
a third-party AllianceAuth app's) to hook a receiver onto without coupling to
wh_mapper.broadcast's websocket fan-out.
"""

# Django
from django.dispatch import Signal

# Sent by wh_mapper.broadcast.broadcast_map_event, once per map mutation.
# kwargs: map_id (int), event (str, e.g. "system.added"), data (dict) - the
# same arguments passed to broadcast_map_event itself - plus user (the
# acting User, or None for a system-driven mutation with no real actor).
map_changed = Signal()
