"""Utility functions for MudVault Mesh."""

import uuid
import time
import re
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from .types import (
    MeshMessage,
    MessageType,
    MessageEndpoint,
    MessagePayload,
    MessageMetadata,
    TellPayload,
    ChannelPayload,
    WhoPayload,
    FingerPayload,
    LocatePayload,
    PingPayload,
    ErrorPayload,
    ChannelAction,
    ErrorCodes,
)


def create_message(
    msg_type: MessageType,
    from_endpoint: MessageEndpoint,
    to_endpoint: MessageEndpoint,
    payload: MessagePayload,
    metadata: Optional[MessageMetadata] = None,
) -> MeshMessage:
    """Create a new mesh message with required fields."""
    if metadata is None:
        metadata = MessageMetadata()
    
    return MeshMessage(
        version="1.0",
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
        type=msg_type,
        from_endpoint=from_endpoint,
        to_endpoint=to_endpoint,
        payload=payload,
        metadata=metadata,
    )


def create_tell_message(
    from_endpoint: MessageEndpoint,
    to_endpoint: MessageEndpoint,
    message: str,
) -> MeshMessage:
    """Create a tell message."""
    return create_message(
        "tell",
        from_endpoint,
        to_endpoint,
        TellPayload(message=message),
    )


def create_channel_message(
    from_endpoint: MessageEndpoint,
    channel: str,
    message: str,
    action: ChannelAction = "message",
) -> MeshMessage:
    """Create a channel message."""
    to_endpoint = MessageEndpoint(mud="*", channel=channel)
    return create_message(
        "channel",
        from_endpoint,
        to_endpoint,
        ChannelPayload(channel=channel, message=message, action=action),
    )


def create_who_request_message(
    from_endpoint: MessageEndpoint,
    target_mud: str,
) -> MeshMessage:
    """Create a who request message."""
    to_endpoint = MessageEndpoint(mud=target_mud)
    return create_message(
        "who",
        from_endpoint,
        to_endpoint,
        WhoPayload(request=True),
    )


def create_finger_request_message(
    from_endpoint: MessageEndpoint,
    target_mud: str,
    target_user: str,
) -> MeshMessage:
    """Create a finger request message."""
    to_endpoint = MessageEndpoint(mud=target_mud, user=target_user)
    return create_message(
        "finger",
        from_endpoint,
        to_endpoint,
        FingerPayload(user=target_user, request=True),
    )


def create_locate_request_message(
    from_endpoint: MessageEndpoint,
    target_user: str,
) -> MeshMessage:
    """Create a locate request message."""
    to_endpoint = MessageEndpoint(mud="*")
    return create_message(
        "locate",
        from_endpoint,
        to_endpoint,
        LocatePayload(user=target_user, request=True),
    )


def create_ping_message(
    from_endpoint: MessageEndpoint,
    to_endpoint: MessageEndpoint,
) -> MeshMessage:
    """Create a ping message."""
    return create_message(
        "ping",
        from_endpoint,
        to_endpoint,
        PingPayload(timestamp=int(time.time() * 1000)),
    )


def create_pong_message(
    from_endpoint: MessageEndpoint,
    to_endpoint: MessageEndpoint,
    original_timestamp: int,
) -> MeshMessage:
    """Create a pong message."""
    return create_message(
        "pong",
        from_endpoint,
        to_endpoint,
        PingPayload(timestamp=original_timestamp),
    )


def create_error_message(
    from_endpoint: MessageEndpoint,
    to_endpoint: MessageEndpoint,
    code: ErrorCodes,
    message: str,
    details: Optional[Dict[str, Any]] = None,
) -> MeshMessage:
    """Create an error message."""
    return create_message(
        "error",
        from_endpoint,
        to_endpoint,
        ErrorPayload(code=code, message=message, details=details),
    )


def is_expired(message: MeshMessage) -> bool:
    """Check if a message has expired based on its TTL."""
    try:
        message_time = datetime.fromisoformat(message.timestamp.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        ttl_seconds = message.metadata.ttl
        
        return (now - message_time).total_seconds() > ttl_seconds
    except (ValueError, AttributeError):
        # If we can't parse the timestamp, consider it expired
        return True


def sanitize_message(message: str, max_length: int = 4096) -> str:
    """Sanitize a message string."""
    # Remove non-printable ASCII characters except newlines/tabs
    sanitized = re.sub(r'[^\x20-\x7E\n\t]', '', message)
    
    # Truncate to max length
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length]
    
    return sanitized.strip()


def validate_mud_name(mud_name: str) -> bool:
    """Validate a MUD name according to mesh protocol rules."""
    if not mud_name or not isinstance(mud_name, str):
        return False
    
    # Must be 1-64 characters, alphanumeric plus underscore/dash
    if not re.match(r'^[a-zA-Z0-9_-]{1,64}$', mud_name):
        return False
    
    return True


def format_message_for_display(message: MeshMessage) -> str:
    """Format a message for display in a MUD."""
    try:
        if message.type == "tell":
            payload = message.payload
            if isinstance(payload, dict) and "message" in payload:
                return f"{message.from_endpoint.user}@{message.from_endpoint.mud} tells you: {payload['message']}"
        
        elif message.type == "channel":
            payload = message.payload
            if isinstance(payload, dict):
                if payload.get("action") == "join":
                    return f"{message.from_endpoint.user}@{message.from_endpoint.mud} has joined channel {payload.get('channel')}"
                elif payload.get("action") == "leave":
                    return f"{message.from_endpoint.user}@{message.from_endpoint.mud} has left channel {payload.get('channel')}"
                else:
                    return f"[{payload.get('channel')}] {message.from_endpoint.user}@{message.from_endpoint.mud}: {payload.get('message', '')}"
        
        elif message.type == "emote":
            payload = message.payload
            if isinstance(payload, dict) and "action" in payload:
                return f"{message.from_endpoint.user}@{message.from_endpoint.mud} {payload['action']}"
        
        elif message.type == "error":
            payload = message.payload
            if isinstance(payload, dict):
                return f"Error {payload.get('code', 'Unknown')}: {payload.get('message', 'Unknown error')}"
        
        # Fallback to JSON representation
        return str(message)
    
    except Exception:
        return f"[Invalid message: {message.type}]"