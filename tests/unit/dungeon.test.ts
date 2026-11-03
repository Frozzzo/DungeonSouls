import { describe, expect, it } from "vitest";
import { floorRules, isBossFloor, MAX_FLOOR } from "@/game/dungeon/floors";
import { generateFloor, validateLayout } from "@/game/dungeon/generate";
import { TILE_WALL } from "@/game/dungeon/types";

describe("generación de pisos", () => {
  it("es determinista: la misma semilla produce el mismo mapa", () => {
    const a = generateFloor(123456, 3);
    const b = generateFloor(123456, 3);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.enemies).toEqual(b.enemies);
    expect(a.exit).toEqual(b.exit);
    expect(Array.from(generateFloor(654321, 3).tiles)).not.toEqual(Array.from(a.tiles));
  });

  it("nunca genera mapas injugables (300 semillas por piso)", () => {
    for (let floor = 1; floor <= MAX_FLOOR; floor++) {
      for (let seed = 1; seed <= 300; seed++) {
        const layout = generateFloor(seed * 7919, floor);
        const check = validateLayout(layout);
        expect(check.problems, `piso ${floor}, semilla ${seed * 7919}`).toEqual([]);
        if (isBossFloor(floor)) {
          expect(layout.boss).not.toBeNull();
          expect(layout.enemies).toHaveLength(0);
        } else {
          expect(layout.enemies.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("la validación detecta una salida inalcanzable", () => {
    const layout = generateFloor(42, 2);
    const broken = { ...layout, tiles: new Uint8Array(layout.tiles) };
    const ex = Math.floor(layout.exit.x);
    const ey = Math.floor(layout.exit.y);
    broken.tiles[ey * layout.width + ex] = TILE_WALL;
    expect(validateLayout(broken).ok).toBe(false);
  });

  it("hay un jefe cada 5 pisos", () => {
    expect(floorRules(5).boss).toBe("ASH_JAILER");
    expect(isBossFloor(10)).toBe(true);
    expect(floorRules(4).boss).toBeNull();
  });
});
