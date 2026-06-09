import { describe, it, expect } from "vitest";
import { buildGeocodeQuery } from "./geocode";

describe("buildGeocodeQuery", () => {
  it("compone dirección, CP y ciudad con España al final", () => {
    expect(buildGeocodeQuery("C/ Químicos, 2", "Majadahonda", "28222")).toBe(
      "C/ Químicos, 2, 28222, Majadahonda, España",
    );
  });
  it("omite partes vacías o nulas", () => {
    expect(buildGeocodeQuery("C/ Alcobendas, 10", "Leganés", null)).toBe(
      "C/ Alcobendas, 10, Leganés, España",
    );
    expect(buildGeocodeQuery("", "Madrid", "")).toBe("Madrid, España");
  });
  it("recorta espacios", () => {
    expect(buildGeocodeQuery("  C/ Mayor  ", "  Alcorcón ", " 28921 ")).toBe(
      "C/ Mayor, 28921, Alcorcón, España",
    );
  });
});
