export type ComponentSlot =
  | "Airframe"
  | "Engine1"
  | "Engine2"
  | "APU"
  | "LandingGearLeft"
  | "LandingGearRight"
  | "LandingGearNose";

export type AssetIdentifierType =
  | "msn"
  | "registration"
  | "engine_serial_number"
  | "apu_serial_number"
  | "landing_gear_nose_serial_number"
  | "landing_gear_left_serial_number"
  | "landing_gear_right_serial_number"
  | "other_component_identifier";

export function sameMsn(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const left = a.trim().toLocaleLowerCase();
  const right = b.trim().toLocaleLowerCase();
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return left.replace(/^0+(?=\d)/, "") === right.replace(/^0+(?=\d)/, "");
  }
  return left === right;
}

export function componentSlot(databaseType: string): ComponentSlot | null {
  const type = databaseType.toLocaleLowerCase().replace(/[_-]+/g, " ").trim();
  if (type === "airframe") return "Airframe";
  if (type === "apu" || type.startsWith("apu ")) return "APU";
  if (type.includes("engine") && /(?:\b1\b|one|position\s*1|no\.?\s*1)/.test(type)) return "Engine1";
  if (type.includes("engine") && /(?:\b2\b|two|position\s*2|no\.?\s*2)/.test(type)) return "Engine2";
  if (!type.includes("landing") && !type.includes("gear")) return null;
  if (type.includes("nose")) return "LandingGearNose";
  if (type.includes("left") || /\b(?:1|one)\b|position\s*1|no\.?\s*1/.test(type)) return "LandingGearLeft";
  if (type.includes("right") || /\b(?:2|two)\b|position\s*2|no\.?\s*2/.test(type)) return "LandingGearRight";
  return null;
}

export function slotForIdentifier(type: AssetIdentifierType, databaseType?: string): ComponentSlot | null {
  const databaseSlot = databaseType ? componentSlot(databaseType) : null;
  if (databaseSlot) return databaseSlot;
  switch (type) {
    case "msn": return "Airframe";
    case "apu_serial_number": return "APU";
    case "landing_gear_nose_serial_number": return "LandingGearNose";
    case "landing_gear_left_serial_number": return "LandingGearLeft";
    case "landing_gear_right_serial_number": return "LandingGearRight";
    default: return null;
  }
}
