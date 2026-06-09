import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  MODEMS_CONFIG: Joi.string().default('./config/modems.yaml'),

  // Security
  API_AUTH_ENABLED: Joi.boolean().default(false),
  API_KEYS: Joi.string().allow('').default(''),
  CORS_ORIGINS: Joi.string().allow('').default('*'),

  // Rate limiting
  THROTTLE_TTL: Joi.number().min(1).default(60),
  THROTTLE_LIMIT: Joi.number().min(1).default(120),

  // OTP webhook (optional)
  OTP_WEBHOOK_URL: Joi.string().uri().allow('').default(''),
  OTP_WEBHOOK_TIMEOUT_MS: Joi.number().min(500).default(5000),

  // Swagger
  SWAGGER_ENABLED: Joi.boolean().default(true),
})
  .unknown(true)
  .required();
