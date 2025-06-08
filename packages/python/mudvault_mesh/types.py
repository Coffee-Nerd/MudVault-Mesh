"""Type definitions for MudVault Mesh protocol."""

from typing import Dict, List, Literal, Optional, Union, Any
from dataclasses import dataclass
from enum import IntEnum


class ErrorCodes(IntEnum):
    """Error codes used in the MudVault Mesh protocol."""
    INVALID_MESSAGE = 1000
    AUTHENTICATION_FAILED = 1001
    UNAUTHORIZED = 1002
    MUD_NOT_FOUND = 1003
    USER_NOT_FOUND = 1004
    CHANNEL_NOT_FOUND = 1005
    RATE_LIMITED = 1006
    INTERNAL_ERROR = 1007
    PROTOCOL_ERROR = 1008
    UNSUPPORTED_VERSION = 1009
    MESSAGE_TOO_LARGE = 1010


MessageType = Literal[
    "tell",
    "emote", 
    "emoteto",
    "channel",
    "who",
    "finger",
    "locate",
    "presence",
    "auth",
    "ping",
    "pong",
    "error"
]

ChannelAction = Literal["join", "leave", "message", "list"]
PresenceStatus = Literal["online", "offline", "away", "busy"]


@dataclass
class MessageEndpoint:
    """Represents a message endpoint (from/to)."""
    mud: str
    user: Optional[str] = None
    display_name: Optional[str] = None
    channel: Optional[str] = None


@dataclass
class MessageMetadata:
    """Message metadata for delivery options."""
    priority: int = 5
    ttl: int = 300
    encoding: str = "utf-8"
    language: str = "en"
    retry: bool = False


@dataclass
class TellPayload:
    """Payload for tell messages."""
    message: str
    formatted: Optional[str] = None


@dataclass
class EmotePayload:
    """Payload for emote messages."""
    action: str
    target: Optional[str] = None
    formatted: Optional[str] = None


@dataclass
class ChannelPayload:
    """Payload for channel messages."""
    channel: str
    message: str
    action: ChannelAction = "message"
    formatted: Optional[str] = None


@dataclass
class WhoPayload:
    """Payload for who requests/responses."""
    users: Optional[List["UserInfo"]] = None
    request: bool = False


@dataclass
class FingerPayload:
    """Payload for finger requests/responses."""
    user: str
    info: Optional["UserInfo"] = None
    request: bool = False


@dataclass
class LocatePayload:
    """Payload for locate requests/responses."""
    user: str
    locations: Optional[List["UserLocation"]] = None
    request: bool = False


@dataclass
class PresencePayload:
    """Payload for presence updates."""
    status: PresenceStatus
    activity: Optional[str] = None
    location: Optional[str] = None


@dataclass
class AuthPayload:
    """Payload for authentication."""
    token: Optional[str] = None
    mud_name: Optional[str] = None
    challenge: Optional[str] = None
    response: Optional[str] = None


@dataclass
class PingPayload:
    """Payload for ping messages."""
    timestamp: int


@dataclass
class ErrorPayload:
    """Payload for error messages."""
    code: int
    message: str
    details: Optional[Dict[str, Any]] = None


MessagePayload = Union[
    TellPayload,
    EmotePayload,
    ChannelPayload,
    WhoPayload,
    FingerPayload,
    LocatePayload,
    PresencePayload,
    AuthPayload,
    PingPayload,
    ErrorPayload,
    Dict[str, Any]  # For flexibility
]


@dataclass
class MeshMessage:
    """A complete MudVault Mesh protocol message."""
    version: str
    id: str
    timestamp: str
    type: MessageType
    from_endpoint: MessageEndpoint
    to_endpoint: MessageEndpoint
    payload: MessagePayload
    metadata: MessageMetadata
    signature: Optional[str] = None


@dataclass
class UserInfo:
    """Information about a user."""
    username: str
    display_name: Optional[str] = None
    idle_time: Optional[int] = None
    location: Optional[str] = None
    level: Optional[int] = None
    race: Optional[str] = None
    class_name: Optional[str] = None
    guild: Optional[str] = None
    last_login: Optional[str] = None
    email: Optional[str] = None
    real_name: Optional[str] = None
    plan: Optional[str] = None


@dataclass
class UserLocation:
    """Location information for a user."""
    mud: str
    room: Optional[str] = None
    area: Optional[str] = None
    online: bool = True


@dataclass
class ConnectionState:
    """Current connection state."""
    connected: bool = False
    authenticated: bool = False
    reconnect_attempts: int = 0
    last_ping: Optional[float] = None
    last_pong: Optional[float] = None


@dataclass
class MeshClientOptions:
    """Configuration options for MeshClient."""
    mud_name: str
    auto_reconnect: bool = True
    reconnect_interval: float = 5.0
    max_reconnect_attempts: int = 10
    heartbeat_interval: float = 30.0
    timeout: float = 10.0