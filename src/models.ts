/**
 * Model registry — all target models available for evaluation
 */

import type { TargetModel } from './types.js';

export const MODELS: TargetModel[] = [
  // Claude 3
  {
    name: 'Claude 3 Opus',
    modelId: 'claude-3-opus-20240229',
    provider: 'anthropic',
    deprecated: true,
    family: 'claude-3',
  },
  {
    name: 'Claude 3 Sonnet',
    modelId: 'claude-3-sonnet-20240229',
    provider: 'bedrock',
    deprecated: true,
    family: 'claude-3',
  },
  // Claude 3.5
  {
    name: 'Claude 3.5 Sonnet',
    modelId: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
    provider: 'bedrock',
    deprecated: true,
    family: 'claude-3.5',
  },
  {
    name: 'Claude 3.5 Haiku',
    modelId: 'claude-3-5-haiku-20241022',
    provider: 'bedrock',
    deprecated: false,
    family: 'claude-3.5',
  },
  // Claude 3.6 (aka 3.5 Sonnet new)
  {
    name: 'Claude 3.6 Sonnet',
    modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    provider: 'bedrock',
    deprecated: false,
    family: 'claude-3.6',
  },
  // Claude 3.7
  {
    name: 'Claude 3.7 Sonnet',
    modelId: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    provider: 'bedrock',
    deprecated: false,
    family: 'claude-3.7',
  },
  // Claude 4
  {
    name: 'Claude 4 Opus',
    modelId: 'claude-opus-4-20250514',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4',
  },
  {
    name: 'Claude 4 Sonnet',
    modelId: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4',
  },
  // Claude 4.1
  {
    name: 'Claude 4.1 Opus',
    modelId: 'claude-opus-4-1-20250805',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4.1',
  },
  // Claude 4.5
  {
    name: 'Claude 4.5 Opus',
    modelId: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4.5',
  },
  {
    name: 'Claude 4.5 Sonnet',
    modelId: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4.5',
  },
  {
    name: 'Claude 4.5 Haiku',
    modelId: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4.5',
  },
  // Claude 4.6
  {
    name: 'Claude 4.6 Opus',
    modelId: 'claude-opus-4-6',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4.6',
  },
  {
    name: 'Claude 4.6 Sonnet',
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    deprecated: false,
    family: 'claude-4.6',
  },
];

export function getModel(name: string): TargetModel {
  const model = MODELS.find(m => m.name === name || m.modelId === name);
  if (!model) throw new Error(`Unknown model: ${name}`);
  return model;
}

export function getModelsByFamily(family: string): TargetModel[] {
  return MODELS.filter(m => m.family === family);
}
