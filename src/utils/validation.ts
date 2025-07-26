import Joi from 'joi';
import { MudVaultMessage, MessageType } from '../types';

const messageEndpointSchema = Joi.object({
  mud: Joi.string().required(),
  user: Joi.string().optional(),
  displayName: Joi.string().optional(),
  channel: Joi.string().optional()
});

const messageMetadataSchema = Joi.object({
  priority: Joi.number().integer().min(1).max(10).default(5),
  ttl: Joi.number().integer().min(1).max(3600).default(300),
  encoding: Joi.string().default('utf-8'),
  language: Joi.string().default('en'),
  retry: Joi.boolean().optional()
});

const basePayloadSchema = Joi.object({
  message: Joi.string().max(4096).optional(),
  formatted: Joi.string().max(8192).optional()
});

const tellPayloadSchema = basePayloadSchema.keys({
  message: Joi.string().max(4096).allow('').required()
});

const emotePayloadSchema = Joi.object({
  action: Joi.string().max(4096).required(),
  target: Joi.string().optional(),
  formatted: Joi.string().max(8192).optional()
});

const channelPayloadSchema = Joi.object({
  channel: Joi.string().required(),
  message: Joi.string().max(4096).allow('').optional(),
  action: Joi.string().valid('join', 'leave', 'message', 'list').optional(),
  formatted: Joi.string().max(8192).optional()
});

const whoUserSchema = Joi.object({
  username: Joi.string().required(),
  displayName: Joi.string().optional(),
  title: Joi.string().optional(),
  level: Joi.string().optional(), // String to support non-numeric levels
  idle: Joi.number().integer().min(0).required(), // Idle time in seconds
  location: Joi.string().optional(),
  flags: Joi.array().items(Joi.string()).optional(), // admin, coder, newbie, etc.
  realName: Joi.string().optional()
});

const whoPayloadSchema = Joi.object({
  users: Joi.array().items(whoUserSchema).optional(),
  request: Joi.boolean().optional(),
  // Optional parameters for who requests
  sort: Joi.string().valid('alpha', 'level', 'idle', 'random').optional(),
  format: Joi.string().valid('short', 'long', 'custom').optional(),
  filter: Joi.object({
    minLevel: Joi.string().optional(),
    maxLevel: Joi.string().optional(),
    flags: Joi.array().items(Joi.string()).optional()
  }).optional()
});

const fingerPayloadSchema = Joi.object({
  user: Joi.string().required(),
  info: Joi.object().optional(),
  request: Joi.boolean().optional()
});

const locatePayloadSchema = Joi.object({
  user: Joi.string().required(),
  locations: Joi.array().items(Joi.object()).optional(),
  request: Joi.boolean().optional()
});

const presencePayloadSchema = Joi.object({
  status: Joi.string().valid('online', 'offline', 'away', 'busy').required(),
  activity: Joi.string().optional(),
  location: Joi.string().optional()
});

const authPayloadSchema = Joi.object({
  token: Joi.string().optional(),
  mudName: Joi.string().optional(),
  challenge: Joi.string().optional(),
  response: Joi.string().optional()
});

const pingPayloadSchema = Joi.object({
  timestamp: Joi.number().required()
});

const errorPayloadSchema = Joi.object({
  code: Joi.number().integer().required(),
  message: Joi.string().required(),
  details: Joi.any().optional()
});

const mudListPayloadSchema = Joi.object({
  muds: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    host: Joi.string().optional(),
    version: Joi.string().optional(),
    admin: Joi.string().optional(),
    email: Joi.string().optional(),
    uptime: Joi.number().optional(),
    users: Joi.number().optional(),
    description: Joi.string().optional()
  })).optional(),
  request: Joi.boolean().optional()
});

const channelsPayloadSchema = Joi.object({
  channels: Joi.array().items(Joi.object({
    name: Joi.string().required(),
    description: Joi.string().optional(),
    memberCount: Joi.number().optional(),
    flags: Joi.array().items(Joi.string()).optional() // public, private, admin, etc.
  })).optional(),
  request: Joi.boolean().optional()
});

const payloadSchemas: Record<MessageType, Joi.ObjectSchema> = {
  tell: tellPayloadSchema,
  emote: emotePayloadSchema,
  emoteto: emotePayloadSchema,
  channel: channelPayloadSchema,
  who: whoPayloadSchema,
  finger: fingerPayloadSchema,
  locate: locatePayloadSchema,
  presence: presencePayloadSchema,
  auth: authPayloadSchema,
  ping: pingPayloadSchema,
  pong: pingPayloadSchema,
  error: errorPayloadSchema,
  mudlist: mudListPayloadSchema,
  channels: channelsPayloadSchema
};

const messageSchema = Joi.object({
  version: Joi.string().valid('1.0').required(),
  id: Joi.string().uuid().required(),
  timestamp: Joi.string().isoDate().required(),
  type: Joi.string().valid(...Object.keys(payloadSchemas)).required(),
  from: messageEndpointSchema.required(),
  to: messageEndpointSchema.required(),
  payload: Joi.object().required(),
  signature: Joi.string().optional(),
  metadata: messageMetadataSchema.required()
});

export function validateMessage(message: any): { error?: string; value?: MudVaultMessage } {
  const { error, value } = messageSchema.validate(message, { allowUnknown: false });
  
  if (error) {
    return { error: error.details[0].message };
  }

  const payloadSchema = payloadSchemas[value.type as MessageType];
  if (!payloadSchema) {
    return { error: `Unknown message type: ${value.type}` };
  }

  const payloadValidation = payloadSchema.validate(value.payload, { allowUnknown: false });
  if (payloadValidation.error) {
    return { error: `Payload validation failed: ${payloadValidation.error.details[0].message}` };
  }

  value.payload = payloadValidation.value;
  return { value: value as MudVaultMessage };
}

export function validateMudName(mudName: string): boolean {
  return /^[a-zA-Z0-9\-_]{3,32}$/.test(mudName);
}

export function normalizeMudName(mudName: string): string {
  // Convert spaces to dashes and remove invalid characters
  return mudName
    .replace(/\s+/g, '-')           // Replace spaces with dashes
    .replace(/[^a-zA-Z0-9\-_]/g, '') // Remove invalid characters
    .replace(/--+/g, '-')           // Replace multiple dashes with single dash
    .replace(/^-|-$/g, '')          // Remove leading/trailing dashes
    .substring(0, 32);              // Limit to 32 characters
}

export function validateAndNormalizeMudName(mudName: string): { valid: boolean; normalized: string; changed: boolean } {
  const normalized = normalizeMudName(mudName);
  const valid = validateMudName(normalized);
  const changed = mudName !== normalized;
  
  return { valid, normalized, changed };
}

export function validateUserName(userName: string): boolean {
  return /^[a-zA-Z0-9\-_]{1,32}$/.test(userName);
}

export function validateChannelName(channelName: string): boolean {
  return /^[a-zA-Z0-9\-_]{1,32}$/.test(channelName);
}