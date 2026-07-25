"""App Views"""

# Standard Library
from typing import Optional

# Django
from django.contrib import messages
from django.contrib.auth.decorators import login_required, permission_required
from django.core.handlers.wsgi import WSGIRequest
from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.translation import gettext as _
from django.views.decorators.csrf import ensure_csrf_cookie

# Alliance Auth
from allianceauth.authentication.models import CharacterOwnership
from allianceauth.eveonline.models import EveCharacter
from esi.decorators import token_required

# AA WH Mapper App
from wh_mapper import __version__
from wh_mapper.api.helpers import start_tracking_character
from wh_mapper.app_settings import WH_MAPPER_WS_ORIGIN
from wh_mapper.constants import LOCATION_SCOPES


@ensure_csrf_cookie
@login_required
@permission_required("wh_mapper.basic_access")
def index(
    request: WSGIRequest, map_id: int | None = None, route_id: int | None = None
) -> HttpResponse:
    """
    Renders the React SPA shell. `map_id`/`route_id` are accepted (but
    unused here) so this same view can serve the "/maps/<id>/" and
    "/route/shared/<id>/" deep-link routes - the React Router-based client
    picks the id up from the URL itself.
    :param request:
    :param map_id:
    :param route_id:
    :return:
    """

    context = {"version": __version__, "ws_origin": WH_MAPPER_WS_ORIGIN}

    return render(request, "wh_mapper/index.html", context)


def _redirect_target(request: WSGIRequest) -> str:
    """Where to send the user back to after the SSO round-trip - the page
    they started from (via `next`) if it's safe, else the map list."""

    next_url = request.GET.get("next")
    if next_url and url_has_allowed_host_and_scheme(
        next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        return next_url

    return "wh_mapper:index"


@login_required
@permission_required("wh_mapper.basic_access")
@token_required(scopes=LOCATION_SCOPES, new=True)
def add_tracked_character(request: WSGIRequest, token) -> HttpResponse:
    """
    Grants an ESI location-read token for a character (chosen at the SSO
    login step) and starts tracking it for the requesting user - it then
    shows up live on every map they have open. Only characters linked to
    the requesting user's own AA account can be tracked.
    :param request:
    :param token:
    :return:
    """

    target = _redirect_target(request)

    owns_character = CharacterOwnership.objects.filter(
        user=request.user, character__character_id=token.character_id
    ).exists()
    if not owns_character:
        messages.error(
            request,
            _(
                "You can only track characters linked to your own account. "
                "Add %(character)s as a character on your account first."
            )
            % {"character": token.character_name},
        )
        return redirect(target)

    character = EveCharacter.objects.get(character_id=token.character_id)
    start_tracking_character(request.user, character)
    messages.success(
        request,
        _("Now tracking %(character)s.") % {"character": character.character_name},
    )

    return redirect(target)
