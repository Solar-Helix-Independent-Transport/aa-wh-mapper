"""Shared test fixtures for wh_mapper's test suite."""

# Third Party
# Django EvE SDE
from eve_sde.models import Constellation, Region, SolarSystem, Stargate

# Django
from django.contrib.auth.models import Permission, User

# Alliance Auth
from allianceauth.authentication.models import CharacterOwnership
from allianceauth.eveonline.models import EveCharacter
from esi.models import Scope, Token

_next_id = iter(range(900001, 999999))


def make_user_with_character(
    username: str,
    character_id: int,
    corporation_id: int = 5000,
    alliance_id: int | None = None,
    perms: tuple[str, ...] = ("wh_mapper.basic_access",),
) -> User:
    """Create a User with a linked, owned main EveCharacter and the given perms."""

    user = User.objects.create_user(username, password="test-password")

    character = EveCharacter.objects.create(
        character_id=character_id,
        character_name=f"{username} Char",
        corporation_id=corporation_id,
        corporation_name=f"Corp {corporation_id}",
        alliance_id=alliance_id,
        alliance_name=f"Alliance {alliance_id}" if alliance_id else "",
    )
    CharacterOwnership.objects.create(
        character=character, owner_hash=f"hash-{character_id}", user=user
    )
    user.profile.main_character = character
    user.profile.save()

    for perm_name in perms:
        app_label, codename = perm_name.split(".")
        user.user_permissions.add(
            Permission.objects.get(content_type__app_label=app_label, codename=codename)
        )

    return user


def make_esi_location_token(user: User, character_id: int, character_name: str, scopes) -> Token:
    """Create a valid (freshly-issued, unexpired) ESI Token with the given
    scopes, bypassing the real SSO round-trip - lets tests exercise code
    paths gated on `Token.objects....require_scopes(...).require_valid()`.

    character_owner_hash must match the owner_hash make_user_with_character
    already set on the CharacterOwnership row for this character - a
    mismatch makes AllianceAuth's Token post_save signal
    (record_character_ownership) treat this as an ownership change: it
    purges the existing CharacterOwnership, which cascades (via
    validate_main_character) into clearing the user's main_character and
    breaking their session on the very next request.
    """

    token = Token.objects.create(
        user=user,
        character_id=character_id,
        character_name=character_name,
        access_token="test-access-token",
        refresh_token="test-refresh-token",
        token_type="Character",
        character_owner_hash=f"hash-{character_id}",
    )
    for scope_name in scopes:
        scope, _ = Scope.objects.get_or_create(
            name=scope_name, defaults={"help_text": ""}
        )
        token.scopes.add(scope)
    return token


def make_solar_system(name: str, **kwargs) -> SolarSystem:
    """Create a minimal SolarSystem (with its Region/Constellation) for tests.

    Pass `id=` to simulate a real J-space system (real IDs in
    31_000_000-32_000_000 are what actually mark a system as wormhole space -
    see `wh_mapper.api.helpers.space_type_label`); otherwise an arbitrary
    k-space-range id is assigned.
    """

    system_id = kwargs.pop("id", None) or next(_next_id)
    region = Region.objects.create(id=next(_next_id), name=f"{name} Region")
    constellation = Constellation.objects.create(
        id=next(_next_id), name=f"{name} Constellation", region=region
    )
    return SolarSystem.objects.create(
        id=system_id, name=name, constellation=constellation, **kwargs
    )


def make_stargate(source: SolarSystem, destination: SolarSystem) -> Stargate:
    """Create a one-directional Stargate row (source -> destination), as
    eve_sde's Stargate model represents each gate in-game."""

    return Stargate.objects.create(
        id=next(_next_id),
        name=f"{source.name} >> {destination.name}",
        solar_system=source,
        destination=destination,
    )
