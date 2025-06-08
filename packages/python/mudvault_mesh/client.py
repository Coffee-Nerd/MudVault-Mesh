"""
MudVault Mesh client implementation.

This module provides the main MeshClient class for connecting to the MudVault Mesh network.
"""

import asyncio
import json
import logging
import time
from typing import Callable, Optional, Dict, Any, Union
import websockets
from websockets.exceptions import ConnectionClosed, InvalidHandshake

from .types import (
    MeshMessage,
    MessageEndpoint,
    MessageType,
    ConnectionState,
    MeshClientOptions,
    UserInfo,
    PresencePayload,
    AuthPayload,
)
from .utils import (
    create_message,
    create_tell_message,
    create_channel_message,
    create_who_request_message,
    create_finger_request_message,
    create_locate_request_message,
    create_ping_message,
    create_pong_message,
    validate_mud_name,
)


logger = logging.getLogger(__name__)


class MeshClient:
    """
    Client for connecting to MudVault Mesh network.
    
    This client handles WebSocket connections, message routing, and automatic
    reconnection to the MudVault Mesh gateway.
    """
    
    def __init__(self, options: Union[MeshClientOptions, str]):
        """
        Initialize the mesh client.
        
        Args:
            options: Client options or just the MUD name as a string
        """
        if isinstance(options, str):
            options = MeshClientOptions(mud_name=options)
        
        if not validate_mud_name(options.mud_name):
            raise ValueError("Invalid MUD name: must be 1-64 alphanumeric characters, underscore, or dash")
        
        self.options = options
        self.state = ConnectionState()
        self._websocket: Optional[websockets.WebSocketServerProtocol] = None
        self._gateway_url = ""
        self._api_key: Optional[str] = None
        
        # Event handlers
        self._handlers: Dict[str, list] = {}
        
        # Background tasks
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._reconnect_task: Optional[asyncio.Task] = None
        
        # Setup logging
        self._setup_logging()
    
    def _setup_logging(self) -> None:
        """Setup logging for the client."""
        if not logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)
    
    def on(self, event: str, handler: Callable) -> None:
        """Register an event handler."""
        if event not in self._handlers:
            self._handlers[event] = []
        self._handlers[event].append(handler)
    
    def off(self, event: str, handler: Optional[Callable] = None) -> None:
        """Remove an event handler."""
        if event not in self._handlers:
            return
        
        if handler is None:
            self._handlers[event] = []
        elif handler in self._handlers[event]:
            self._handlers[event].remove(handler)
    
    def _emit(self, event: str, *args, **kwargs) -> None:
        """Emit an event to all registered handlers."""
        if event in self._handlers:
            for handler in self._handlers[event]:
                try:
                    if asyncio.iscoroutinefunction(handler):
                        asyncio.create_task(handler(*args, **kwargs))
                    else:
                        handler(*args, **kwargs)
                except Exception as e:
                    logger.error(f"Error in event handler for {event}: {e}")
    
    async def connect(
        self,
        gateway_url: str = "wss://mesh.mudvault.org",
        api_key: Optional[str] = None
    ) -> None:
        """
        Connect to the MudVault Mesh gateway.
        
        Args:
            gateway_url: WebSocket URL of the gateway
            api_key: Optional API key for authentication
        """
        if self.state.connected:
            raise RuntimeError("Already connected")
        
        self._gateway_url = gateway_url
        self._api_key = api_key
        
        try:
            logger.info(f"Connecting to {gateway_url}")
            
            self._websocket = await asyncio.wait_for(
                websockets.connect(gateway_url),
                timeout=self.options.timeout
            )
            
            self.state.connected = True
            self.state.reconnect_attempts = 0
            
            logger.info("Connected to MudVault Mesh")
            self._emit("connected")
            
            # Start background tasks
            self._start_background_tasks()
            
            # Authenticate
            await self._authenticate()
            
            # Start listening for messages
            await self._listen()
            
        except asyncio.TimeoutError:
            raise ConnectionError("Connection timeout")
        except Exception as e:
            logger.error(f"Connection failed: {e}")
            raise ConnectionError(f"Failed to connect: {e}")
    
    async def disconnect(self) -> None:
        """Disconnect from the gateway."""
        logger.info("Disconnecting from MudVault Mesh")
        
        # Stop auto-reconnect
        self.options.auto_reconnect = False
        
        # Cancel background tasks
        await self._stop_background_tasks()
        
        # Close WebSocket connection
        if self._websocket:
            await self._websocket.close()
            self._websocket = None
        
        self.state.connected = False
        self.state.authenticated = False
        
        self._emit("disconnected", {"code": 1000, "reason": "Normal closure"})
    
    async def _authenticate(self) -> None:
        """Authenticate with the gateway."""
        auth_message = create_message(
            "auth",
            MessageEndpoint(mud=self.options.mud_name),
            MessageEndpoint(mud="Gateway"),
            AuthPayload(
                mud_name=self.options.mud_name,
                token=self._api_key
            )
        )
        
        await self._send_message(auth_message)
        
        # Wait a bit for potential auth error
        await asyncio.sleep(1.0)
        
        if self.state.connected:  # If still connected, assume auth succeeded
            self.state.authenticated = True
            logger.info("Authenticated with MudVault Mesh")
            self._emit("authenticated")
    
    async def _listen(self) -> None:
        """Listen for incoming messages."""
        try:
            while self.state.connected and self._websocket:
                try:
                    message_data = await self._websocket.recv()
                    await self._handle_message(message_data)
                    
                except ConnectionClosed:
                    logger.info("Connection closed by server")
                    break
                except Exception as e:
                    logger.error(f"Error receiving message: {e}")
                    
        except Exception as e:
            logger.error(f"Listen loop error: {e}")
        finally:
            await self._handle_disconnection()
    
    async def _handle_message(self, data: Union[str, bytes]) -> None:
        """Handle an incoming message."""
        try:
            if isinstance(data, bytes):
                data = data.decode('utf-8')
            
            message_dict = json.loads(data)
            message = self._parse_message(message_dict)
            
            # Update last activity
            self.state.last_pong = time.time()
            
            # Handle special message types
            if message.type == "ping":
                await self._handle_ping(message)
            elif message.type == "pong":
                await self._handle_pong(message)
            elif message.type == "error":
                await self._handle_error(message)
            else:
                # Emit generic message event
                self._emit("message", message)
                # Emit specific message type event
                self._emit(message.type, message)
                
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse message JSON: {e}")
            self._emit("error", f"Invalid JSON received: {e}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            self._emit("error", f"Message handling error: {e}")
    
    def _parse_message(self, data: Dict[str, Any]) -> MeshMessage:
        """Parse a message dictionary into a MeshMessage object."""
        # Basic validation
        required_fields = ["version", "id", "timestamp", "type", "from", "to", "payload", "metadata"]
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")
        
        # Convert from/to dicts to MessageEndpoint objects
        from_endpoint = MessageEndpoint(**data["from"])
        to_endpoint = MessageEndpoint(**data["to"])
        
        # Create message object
        return MeshMessage(
            version=data["version"],
            id=data["id"],
            timestamp=data["timestamp"],
            type=data["type"],
            from_endpoint=from_endpoint,
            to_endpoint=to_endpoint,
            payload=data["payload"],
            metadata=data["metadata"],
            signature=data.get("signature")
        )
    
    async def _handle_ping(self, message: MeshMessage) -> None:
        """Handle incoming ping message."""
        if isinstance(message.payload, dict) and "timestamp" in message.payload:
            pong_message = create_pong_message(
                MessageEndpoint(mud=self.options.mud_name),
                MessageEndpoint(mud="Gateway"),
                message.payload["timestamp"]
            )
            await self._send_message(pong_message)
    
    async def _handle_pong(self, message: MeshMessage) -> None:
        """Handle incoming pong message."""
        if isinstance(message.payload, dict) and "timestamp" in message.payload:
            latency = time.time() * 1000 - message.payload["timestamp"]
            self._emit("pong", {"latency": latency})
    
    async def _handle_error(self, message: MeshMessage) -> None:
        """Handle incoming error message."""
        if isinstance(message.payload, dict):
            error_msg = f"Server error {message.payload.get('code', 'Unknown')}: {message.payload.get('message', 'Unknown error')}"
            logger.error(error_msg)
            self._emit("error", error_msg)
    
    async def _handle_disconnection(self) -> None:
        """Handle disconnection."""
        self.state.connected = False
        self.state.authenticated = False
        
        await self._stop_background_tasks()
        
        if self._websocket:
            self._websocket = None
        
        self._emit("disconnected", {"code": 1006, "reason": "Connection lost"})
        
        # Schedule reconnection if enabled
        if self.options.auto_reconnect and self.state.reconnect_attempts < self.options.max_reconnect_attempts:
            self._reconnect_task = asyncio.create_task(self._schedule_reconnect())
    
    async def _schedule_reconnect(self) -> None:
        """Schedule a reconnection attempt."""
        self.state.reconnect_attempts += 1
        delay = self.options.reconnect_interval * (2 ** (self.state.reconnect_attempts - 1))
        
        logger.info(f"Scheduling reconnect attempt {self.state.reconnect_attempts} in {delay}s")
        self._emit("reconnecting", {"attempt": self.state.reconnect_attempts})
        
        await asyncio.sleep(delay)
        
        try:
            await self.connect(self._gateway_url, self._api_key)
        except Exception as e:
            logger.error(f"Reconnect attempt {self.state.reconnect_attempts} failed: {e}")
            self._emit("reconnect_failed", {"attempt": self.state.reconnect_attempts, "error": str(e)})
            
            if self.state.reconnect_attempts < self.options.max_reconnect_attempts:
                self._reconnect_task = asyncio.create_task(self._schedule_reconnect())
            else:
                logger.error("Max reconnection attempts reached")
                self._emit("reconnect_give_up")
    
    def _start_background_tasks(self) -> None:
        """Start background tasks."""
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
    
    async def _stop_background_tasks(self) -> None:
        """Stop background tasks."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None
        
        if self._reconnect_task:
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
            self._reconnect_task = None
    
    async def _heartbeat_loop(self) -> None:
        """Send periodic ping messages."""
        try:
            while self.state.connected:
                await asyncio.sleep(self.options.heartbeat_interval)
                
                if not self.state.connected:
                    break
                
                # Check for missed pongs
                now = time.time()
                if (self.state.last_ping and 
                    self.state.last_pong and 
                    (now - self.state.last_pong) > (self.options.heartbeat_interval * 2)):
                    logger.warning("Heartbeat timeout - connection may be lost")
                    if self._websocket:
                        await self._websocket.close()
                    break
                
                # Send ping
                self.state.last_ping = now
                ping_message = create_ping_message(
                    MessageEndpoint(mud=self.options.mud_name),
                    MessageEndpoint(mud="Gateway")
                )
                
                try:
                    await self._send_message(ping_message)
                except Exception as e:
                    logger.error(f"Failed to send ping: {e}")
                    break
                    
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Heartbeat loop error: {e}")
    
    async def _send_message(self, message: MeshMessage) -> None:
        """Send a message to the gateway."""
        if not self._websocket or not self.state.connected:
            raise RuntimeError("Not connected to gateway")
        
        # Convert message to dict for JSON serialization
        message_dict = {
            "version": message.version,
            "id": message.id,
            "timestamp": message.timestamp,
            "type": message.type,
            "from": {
                "mud": message.from_endpoint.mud,
                "user": message.from_endpoint.user,
                "displayName": message.from_endpoint.display_name,
                "channel": message.from_endpoint.channel,
            },
            "to": {
                "mud": message.to_endpoint.mud,
                "user": message.to_endpoint.user,
                "displayName": message.to_endpoint.display_name,
                "channel": message.to_endpoint.channel,
            },
            "payload": message.payload.__dict__ if hasattr(message.payload, '__dict__') else message.payload,
            "metadata": message.metadata.__dict__ if hasattr(message.metadata, '__dict__') else message.metadata,
        }
        
        if message.signature:
            message_dict["signature"] = message.signature
        
        # Remove None values to clean up JSON
        def remove_none(obj):
            if isinstance(obj, dict):
                return {k: remove_none(v) for k, v in obj.items() if v is not None}
            return obj
        
        message_dict = remove_none(message_dict)
        
        try:
            await self._websocket.send(json.dumps(message_dict))
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            raise
    
    # Public API methods
    async def send_tell(self, to_endpoint: MessageEndpoint, message: str) -> None:
        """Send a tell message."""
        tell_message = create_tell_message(
            MessageEndpoint(mud=self.options.mud_name, user="System"),
            to_endpoint,
            message
        )
        await self._send_message(tell_message)
    
    async def send_channel_message(self, channel: str, message: str, user: str = "System") -> None:
        """Send a channel message."""
        channel_message = create_channel_message(
            MessageEndpoint(mud=self.options.mud_name, user=user),
            channel,
            message
        )
        await self._send_message(channel_message)
    
    async def join_channel(self, channel: str, user: str = "System") -> None:
        """Join a channel."""
        join_message = create_channel_message(
            MessageEndpoint(mud=self.options.mud_name, user=user),
            channel,
            "",
            "join"
        )
        await self._send_message(join_message)
    
    async def leave_channel(self, channel: str, user: str = "System") -> None:
        """Leave a channel."""
        leave_message = create_channel_message(
            MessageEndpoint(mud=self.options.mud_name, user=user),
            channel,
            "",
            "leave"
        )
        await self._send_message(leave_message)
    
    async def request_who(self, target_mud: str) -> None:
        """Request who list from a MUD."""
        who_message = create_who_request_message(
            MessageEndpoint(mud=self.options.mud_name),
            target_mud
        )
        await self._send_message(who_message)
    
    async def request_finger(self, target_mud: str, target_user: str) -> None:
        """Request finger info for a user."""
        finger_message = create_finger_request_message(
            MessageEndpoint(mud=self.options.mud_name),
            target_mud,
            target_user
        )
        await self._send_message(finger_message)
    
    async def request_locate(self, target_user: str) -> None:
        """Locate a user across all MUDs."""
        locate_message = create_locate_request_message(
            MessageEndpoint(mud=self.options.mud_name),
            target_user
        )
        await self._send_message(locate_message)
    
    async def set_user_online(self, user_info: UserInfo) -> None:
        """Mark a user as online."""
        presence_message = create_message(
            "presence",
            MessageEndpoint(mud=self.options.mud_name, user=user_info.username),
            MessageEndpoint(mud="Gateway"),
            PresencePayload(
                status="online",
                activity=user_info.location,
                location=user_info.location
            )
        )
        await self._send_message(presence_message)
    
    async def set_user_offline(self, username: str) -> None:
        """Mark a user as offline."""
        presence_message = create_message(
            "presence",
            MessageEndpoint(mud=self.options.mud_name, user=username),
            MessageEndpoint(mud="Gateway"),
            PresencePayload(status="offline")
        )
        await self._send_message(presence_message)
    
    # Property accessors
    @property
    def is_connected(self) -> bool:
        """Check if connected to gateway."""
        return self.state.connected
    
    @property
    def is_authenticated(self) -> bool:
        """Check if authenticated with gateway."""
        return self.state.authenticated
    
    @property
    def connection_state(self) -> ConnectionState:
        """Get current connection state."""
        return self.state
    
    @property
    def mud_name(self) -> str:
        """Get MUD name."""
        return self.options.mud_name