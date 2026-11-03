import { ATTRIBUTE_KEYS, type Attributes } from "./types";

export function addAttributes(...parts: Attributes[]): Attributes {
  const out: Attributes = { strength: 0, dexterity: 0, intelligence: 0, vitality: 0 };
  for (const p of parts) {
    for (const key of ATTRIBUTE_KEYS) out[key] += p[key];
  }
  return out;
}

export function sumAttributes(a: Attributes): number {
  return ATTRIBUTE_KEYS.reduce((acc, key) => acc + a[key], 0);
}

export function scaleAttributes(a: Attributes, factor: number): Attributes {
  const out = { ...a };
  for (const key of ATTRIBUTE_KEYS) out[key] = Math.floor(a[key] * factor);
  return out;
}
