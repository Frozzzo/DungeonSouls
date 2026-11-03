# Modelo de datos

PostgreSQL con Prisma 7. Principio general: **el contenido (habilidades, objetos base, enemigos, jefes, dificultades) se define en código tipado** dentro de `src/game`; **la base de datos guarda el estado de cada jugador** y referencia ese contenido por identificador estable (`"tank-shield-wall"`, `"iron-helm"`). Así se versiona el contenido con el código, se prueba sin base de datos y se evita guardar el juego en un JSON sin estructura.

## Fase 1 (implementado)

Ver `prisma/schema.prisma`.

| Modelo | Propósito | Notas |
| --- | --- | --- |
| `User` | Cuenta | `email` en minúsculas y único; `usernameKey` (minúsculas) único; `passwordHash` en formato `scrypt$N$r$p$sal$hash` |
| `Session` | Sesión de servidor | Solo se guarda `tokenHash` (SHA-256 del token de la cookie); caduca a los 30 días; borrado en cascada con el usuario |
| `AuthAttempt` | Límite de intentos | `kind` (LOGIN/REGISTER), `key` con hash (`email:` o `ip:`), `success`; índice por `(kind, key, createdAt)`; limpieza oportunista de registros de más de 24 h |
| `Character` | Progreso permanente | `class` (enum), `level`, `experience` (dentro del nivel), `statPoints`, `skillPoints`, `allocated*` por atributo; `nameKey` único global sin distinguir mayúsculas |

Las estadísticas totales y derivadas **no se guardan**: se calculan con `computeCharacterStats(class, level, allocated, bonusDeEquipo)`.

Garantías ya implementadas:

- Límite de personajes por usuario en transacción `Serializable` (sin superar el máximo con peticiones simultáneas).
- Asignación de puntos con escritura condicional (`updateMany` con `statPoints` y `updatedAt` esperados): dos peticiones simultáneas no gastan los mismos puntos.
- Toda consulta de personaje filtra por `userId` del usuario de la sesión.

## Fase 2 (implementado)

| Modelo | Propósito | Notas |
| --- | --- | --- |
| `Character.highestFloorCleared` | Progreso de descenso | Desbloquea el piso siguiente (hasta el 5 en esta fase) |
| `DungeonRun` | Intento de un piso (progreso temporal) | `floor`, `difficulty`, `seed` (31 bits), `simVersion`, instantánea `levelAtStart` + `allocatedAtStart` (JSON validado con Zod), `status` (ACTIVE, COMPLETED, FAILED, ABANDONED), `outcome` (JSON validado: resultado verificado, XP, nivel antes/después), `rejectedSubmissions` (máx. 5) |
| `RewardGrant` | Recompensa concedida | `idempotencyKey` único (`run:<intento>:<personaje>`), `runId` único, `xp`, `levelsGained` |
| `ItemInstance` | Inventario | `baseItemId` (catálogo en `src/game/items/bases.ts`), `rarity` (6 valores), `itemLevel`, `affixes` (JSON validado con Zod al leer y escribir), `sourceRewardGrantId` |

Un personaje tiene como máximo un intento activo: empezar otro abandona el anterior (transacción serializable con reintento). Cuando lleguen grupos (Fase 4), `DungeonRun` se generaliza en `Expedition` + `Encounter`; las recompensas ya usan el mismo patrón idempotente.

## Fase 3 (implementado)

| Modelo | Propósito | Notas |
| --- | --- | --- |
| `CharacterSkill` | Rango por habilidad aprendida | `@@unique([characterId, skillId])`, `CHECK rank >= 1`; el tope (`maxRank`) lo valida el servicio con escritura condicional |
| `CharacterLoadoutSlot` | Habilidades equipadas | `@@unique([characterId, slot])` y `@@unique([characterId, skillId])`: máximo 4 y sin repetir |
| `EquipmentSlot` | Objeto puesto en cada hueco | `@@unique([characterId, slot])`, `itemInstanceId @unique`; FK a `ItemInstance` con `NO ACTION`: un objeto equipado no se puede borrar |
| `ConsumableStack` | Pociones | Tope por tipo; `CHECK quantity >= 0`; el ajuste al cerrar un intento es una sola sentencia con `LEAST/GREATEST` |
| `MaterialStack` | Polvo abisal (desmontar) | `CHECK quantity >= 0` |
| `DungeonRun.loadoutAtStart`, `gearAtStart`, `potionsAtStart` | Instantánea de la progresión al empezar | Validadas con Zod; cambiar habilidades o equipo no altera una partida empezada |

La migración da a los personajes existentes su habilidad inicial equipada, 1 punto de habilidad y 3 pociones, y abandona los intentos activos (cambió `SIM_VERSION`).

## Diseño completo (fases 2–5)

```
User 1─* Character 1─* CharacterSkill            (rango por habilidad desbloqueada)
                   1─* CharacterLoadoutSlot      (BASIC_1..3 + ULTIMATE)
                   1─* ItemInstance              (inventario: objetos concretos)
                   1─* EquipmentSlot ─1 ItemInstance
                   1─* ConsumableStack
User 1─* PartyMember *─1 Party 1─* Expedition 1─* ExpeditionParticipant *─1 Character
                                              1─* Encounter 1─* RewardGrant *─1 Character
                                                            1─* CombatLog (opcional)
RewardGrant 1─* ItemInstance (origen del botín)
```

### Habilidades (Fase 3)

| Modelo | Campos | Restricciones |
| --- | --- | --- |
| `CharacterSkill` | `characterId`, `skillId` (id del código), `rank`, `unlockedAt` | `@@unique([characterId, skillId])`; `rank` ≤ `maxRank` de la definición (validado en servicio) |
| `CharacterLoadoutSlot` | `characterId`, `slot` (`BASIC_1`, `BASIC_2`, `BASIC_3`, `ULTIMATE`), `skillId` | `@@unique([characterId, slot])` y `@@unique([characterId, skillId])`: como máximo 4 equipadas y sin repetir; el ataque básico no ocupa espacio; solo se cambia fuera de combate |

La definición de cada habilidad (`src/game/skills`) incluye id, nombre, descripción, clase, rama, requisitos, coste, rango máximo, tipo (básica/ultimate), alcance, área, objetivos válidos, coste de recurso, enfriamiento base y mínimo, escalado por estadísticas, estados aplicados, interrupciones y mejoras por rango.

### Objetos e inventario (Fases 2–3)

| Modelo | Campos | Notas |
| --- | --- | --- |
| `ItemInstance` | `id`, `characterId`, `baseItemId`, `rarity` (6 valores), `itemLevel`, `affixes` (JSON validado con Zod contra el catálogo), `uniqueEffectId?`, `sourceRewardGrantId?`, `createdAt` | Un objeto concreto; `affixes` es la única parte JSON y siempre se valida al leer y escribir |
| `EquipmentSlot` | `characterId`, `slot` (WEAPON, HELMET, CHEST, GLOVES, LEGS, BOOTS, ACCESSORY_1, ACCESSORY_2), `itemInstanceId` | `@@unique([characterId, slot])`, `itemInstanceId @unique` (un objeto en un solo hueco) |
| `ConsumableStack` | `characterId`, `consumableId`, `quantity` | `@@unique([characterId, consumableId])`; `quantity` con tope por tipo |
| `MaterialStack` | igual que `ConsumableStack` | Solo si se añade fabricación |

Desmontar o vender un objeto se hace en una transacción que borra la instancia y suma materiales u oro.

### Grupos y expediciones (Fase 4)

| Modelo | Campos | Notas |
| --- | --- | --- |
| `Party` | `id`, `code` (único, 6 caracteres), `leaderUserId`, `status` (OPEN, IN_EXPEDITION, CLOSED), `createdAt` | Máximo 4 miembros (validado en transacción) |
| `PartyMember` | `partyId`, `userId`, `characterId`, `ready`, `joinedAt` | `@@unique([userId])` en grupos activos: un usuario está en un solo grupo |
| `Expedition` | `id`, `partyId`, `difficulty` (enum), `seed` (bigint), `status` (ACTIVE, COMPLETED, DEFEATED, ABANDONED), `currentFloor`, `startedAt`, `endedAt` | Dificultad y semilla inmutables tras crearse |
| `ExpeditionParticipant` | `expeditionId`, `characterId`, `levelAtStart`, `status` (ACTIVE, DISCONNECTED, LEFT), `deaths`, `revives`, `joinedAt`, `leftAt` | Progreso temporal; no toca el progreso permanente |
| `Encounter` | `id`, `expeditionId`, `floor`, `kind` (PACK, ELITE, EVENT, CHEST, BOSS), `templateId`, `status`, `startedAt`, `completedAt` | `@@unique([expeditionId, floor, templateId])` |
| `RewardGrant` | `id`, `idempotencyKey` (**único**), `characterId`, `encounterId`, `xp`, `gold`, `createdAt` | Clave `<expedición>:<encuentro>:<personaje>`; aplicar dos veces la misma recompensa falla por la restricción y devuelve la existente |
| `CombatLog` | `expeditionId`, `encounterId`, `summary` (JSON validado), `createdAt` | Opcional: depuración y estadísticas, no fuente de verdad |

Los enemigos y jefes no se guardan individualmente: el estado de combate vive en el servidor de partida durante el encuentro y solo el **resultado** se persiste.
