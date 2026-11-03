/** Estados alterados de la Fase 2. Duraciones en ticks dentro de la simulación. */
export const STATUS_IDS = ["SLOW", "STUN", "FORTIFIED"] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export interface StatusDefinition {
  id: StatusId;
  name: string;
  description: string;
  /** Multiplicador de velocidad de movimiento mientras dura. */
  moveMultiplier: number;
  /** Impide moverse, atacar y esquivar. */
  incapacitates: boolean;
  negative: boolean;
}

export const STATUS_DEFINITIONS: Record<StatusId, StatusDefinition> = {
  SLOW: { id: "SLOW", name: "Ralentizado", description: "Te mueves un 40 % más despacio.", moveMultiplier: 0.6, incapacitates: false, negative: true },
  STUN: { id: "STUN", name: "Aturdido", description: "No puedes actuar.", moveMultiplier: 0, incapacitates: true, negative: true },
  FORTIFIED: { id: "FORTIFIED", name: "Bastión", description: "Recibes la mitad de daño.", moveMultiplier: 1, incapacitates: false, negative: false },
};

export interface ActiveStatus {
  id: StatusId;
  ticks: number;
  /** Magnitud específica (p. ej. reducción de FORTIFIED). */
  value: number;
}

/** Aplica o renueva un estado (se queda con la duración y magnitud mayores, sin acumular). */
export function applyStatus(list: ActiveStatus[], id: StatusId, ticks: number, value = 0): void {
  const existing = list.find((s) => s.id === id);
  if (existing) {
    existing.ticks = Math.max(existing.ticks, ticks);
    existing.value = Math.max(existing.value, value);
  } else {
    list.push({ id, ticks, value });
  }
}

export function hasStatus(list: readonly ActiveStatus[], id: StatusId): boolean {
  return list.some((s) => s.id === id);
}

export function statusValue(list: readonly ActiveStatus[], id: StatusId): number {
  return list.find((s) => s.id === id)?.value ?? 0;
}

export function moveMultiplier(list: readonly ActiveStatus[]): number {
  let m = 1;
  for (const s of list) m *= STATUS_DEFINITIONS[s.id].moveMultiplier;
  return m;
}

export function isIncapacitated(list: readonly ActiveStatus[]): boolean {
  return list.some((s) => STATUS_DEFINITIONS[s.id].incapacitates);
}

/** Resta un tick a cada estado y elimina los que terminan. */
export function tickStatuses(list: ActiveStatus[]): ActiveStatus[] {
  const out: ActiveStatus[] = [];
  for (const s of list) {
    if (s.ticks > 1) out.push({ ...s, ticks: s.ticks - 1 });
  }
  return out;
}
