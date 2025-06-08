"""
MudVault Mesh - Python client library for connecting to MudVault Mesh network.

This library provides a simple async interface for connecting MUDs to the
MudVault Mesh inter-MUD communication network.
"""

from .client import MeshClient
from .types import (
    MeshMessage,
    MessageEndpoint,
    MessageMetadata,
    MessageType,
    ConnectionState,
    UserInfo,
    UserLocation,
    ErrorCodes,
)

__version__ = "1.0.0"
__author__ = "MudVault Team"
__email__ = "asmodeusbrooding@gmail.com"

__all__ = [
    "MeshClient",
    "MeshMessage", 
    "MessageEndpoint",
    "MessageMetadata",
    "MessageType",
    "ConnectionState",
    "UserInfo",
    "UserLocation", 
    "ErrorCodes",
]