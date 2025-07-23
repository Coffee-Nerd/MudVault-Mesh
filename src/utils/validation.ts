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
  message: Joi.string().max(4096).required()
});

const emotePayloadSchema = Joi.object({
  action: Joi.string().max(4096).required(),
  target: Joi.string().optional(),
  formatted: Joi.string().max(8192).optional()
});

const channelPayloadSchema = Joi.object({
  channel: Joi.string().required(),
  message: Joi.string().max(4096).optional(),
  action: Joi.string().valid('join', 'leave', 'message', 'list').optional(),
  formatted: Joi.string().max(8192).optional()
});

const whoPayloadSchema = Joi.object({
  users: Joi.array().items(Joi.object()).optional(),
  request: Joi.boolean().optional()
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
  error: errorPayloadSchema
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

export function validateUserName(userName: string): boolean {
  return /^[a-zA-Z0-9\-_]{1,32}$/.test(userName);
}

export function validateChannelName(channelName: string): boolean {
  return /^[a-zA-Z0-9\-_]{1,32}$/.test(channelName);
}