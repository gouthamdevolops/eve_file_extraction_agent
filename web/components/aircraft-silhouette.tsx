"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { componentLabel, formatNumber, type AircraftFamily, type ComponentSlot, type ComponentView } from "@/lib/aircraft-view";

const W = 400;
const H = 480;
const CX = W / 2;

interface Surface { rootY: number; rootChord: number; span: number; tipY: number; tipChord: number }
interface EngineSpec { dx: number; len: number; w: number }
interface Geometry {
  noseY: number;
  tailY: number;
  hw: number;
  wing: Surface;
  stab: Surface;
  tTail: boolean;
  engineMount: "wing" | "rear";
  prop: boolean;
  /** Inner pair first. Twins have one entry, four-engine types two. */
  engines: EngineSpec[];
  rearEngineY: number;
  mainGear: { dx: number; y: number; bogie: boolean };
  noseGearY: number;
}

const narrowbody: Geometry = {
  noseY: 28, tailY: 448, hw: 19,
  wing: { rootY: 190, rootChord: 92, span: 182, tipY: 292, tipChord: 24 },
  stab: { rootY: 386, rootChord: 40, span: 72, tipY: 420, tipChord: 16 },
  tTail: false, engineMount: "wing", prop: false,
  engines: [{ dx: 74, len: 52, w: 24 }], rearEngineY: 0,
  mainGear: { dx: 26, y: 262, bogie: false }, noseGearY: 80,
};

const widebody: Geometry = {
  noseY: 16, tailY: 462, hw: 25,
  wing: { rootY: 172, rootChord: 122, span: 194, tipY: 312, tipChord: 26 },
  stab: { rootY: 384, rootChord: 50, span: 90, tipY: 430, tipChord: 18 },
  tTail: false, engineMount: "wing", prop: false,
  engines: [{ dx: 84, len: 66, w: 32 }], rearEngineY: 0,
  mainGear: { dx: 34, y: 262, bogie: true }, noseGearY: 66,
};

const GEOMETRY: Record<AircraftFamily, Geometry> = {
  narrowbody,
  unknown: narrowbody,
  widebody,
  "widebody-quad": { ...widebody, engines: [{ dx: 74, len: 54, w: 25 }, { dx: 138, len: 48, w: 22 }] },
  "regional-rear": {
    noseY: 48, tailY: 440, hw: 16,
    wing: { rootY: 204, rootChord: 70, span: 160, tipY: 262, tipChord: 22 },
    stab: { rootY: 402, rootChord: 26, span: 68, tipY: 414, tipChord: 16 },
    tTail: true, engineMount: "rear", prop: false,
    engines: [{ dx: 33, len: 56, w: 22 }], rearEngineY: 326,
    mainGear: { dx: 22, y: 258, bogie: false }, noseGearY: 88,
  },
  turboprop: {
    noseY: 52, tailY: 440, hw: 17,
    wing: { rootY: 180, rootChord: 44, span: 188, tipY: 184, tipChord: 30 },
    stab: { rootY: 404, rootChord: 28, span: 64, tipY: 410, tipChord: 18 },
    tTail: true, engineMount: "wing", prop: true,
    engines: [{ dx: 64, len: 74, w: 18 }], rearEngineY: 0,
    mainGear: { dx: 23, y: 230, bogie: false }, noseGearY: 86,
  },
};

function surfacePath(s: Surface, hw: number): string {
  const side = (sign: 1 | -1) => [
    `${CX + sign * hw},${s.rootY}`,
    `${CX + sign * s.span},${s.tipY}`,
    `${CX + sign * s.span},${s.tipY + s.tipChord}`,
    `${CX + sign * hw},${s.rootY + s.rootChord}`,
  ];
  return `M${side(1).join(" L")} Z M${side(-1).join(" L")} Z`;
}

function fuselagePath({ noseY, tailY, hw }: Geometry): string {
  const len = tailY - noseY;
  const noseEnd = noseY + hw * 2.6;
  const tailStart = tailY - len * 0.2;
  return [
    `M${CX},${noseY}`,
    `C${CX + hw * 0.75},${noseY} ${CX + hw},${noseY + hw * 1.1} ${CX + hw},${noseEnd}`,
    `L${CX + hw},${tailStart}`,
    `C${CX + hw},${tailStart + len * 0.12} ${CX + hw * 0.35},${tailY - 4} ${CX + hw * 0.2},${tailY}`,
    `L${CX - hw * 0.2},${tailY}`,
    `C${CX - hw * 0.35},${tailY - 4} ${CX - hw},${tailStart + len * 0.12} ${CX - hw},${tailStart}`,
    `L${CX - hw},${noseEnd}`,
    `C${CX - hw},${noseY + hw * 1.1} ${CX - hw * 0.75},${noseY} ${CX},${noseY} Z`,
  ].join(" ");
}

/** y of the wing leading edge at horizontal offset dx from the centreline. */
function leadingEdgeAt(g: Geometry, dx: number): number {
  const { rootY, tipY, span } = g.wing;
  return rootY + ((dx - g.hw) / (span - g.hw)) * (tipY - rootY);
}

interface EngineShape { slot: ComponentSlot | null; position: number; x: number; y: number; len: number; w: number }

/** Engines numbered left to right as seen from above, nose up (port = 1), matching operator convention. */
function engineShapes(g: Geometry): EngineShape[] {
  const offsets = [...g.engines].reverse().map((e) => ({ ...e, dx: -e.dx })).concat(g.engines);
  const slots: Array<ComponentSlot | null> = offsets.length === 2 ? ["Engine1", "Engine2"] : ["Engine1", "Engine2", null, null];
  return offsets.map((e, index) => {
    const x = CX + e.dx;
    const y = g.engineMount === "rear"
      ? g.rearEngineY
      : leadingEdgeAt(g, Math.abs(e.dx)) - e.len * (g.prop ? 0.32 : 0.62);
    return { slot: slots[index], position: index + 1, x, y, len: e.len, w: e.w };
  });
}

interface Anchor { x: number; y: number }

function anchors(g: Geometry, engines: EngineShape[]): Record<ComponentSlot, Anchor> {
  const engineAnchor = (slot: ComponentSlot) => {
    const e = engines.find((item) => item.slot === slot)!;
    return { x: e.x, y: e.y + e.len / 2 };
  };
  return {
    Airframe: { x: CX, y: g.noseY + (g.tailY - g.noseY) * 0.22 },
    Engine1: engineAnchor("Engine1"),
    Engine2: engineAnchor("Engine2"),
    APU: { x: CX, y: g.tailY - 12 },
    LandingGearNose: { x: CX, y: g.noseGearY },
    LandingGearLeft: { x: CX - g.mainGear.dx, y: g.mainGear.y },
    LandingGearRight: { x: CX + g.mainGear.dx, y: g.mainGear.y },
  };
}

function Wheels({ x, y, bogie }: { x: number; y: number; bogie: boolean }) {
  const rows = bogie ? [-9, 9] : [0];
  return <>{rows.flatMap((dy) => [-4, 4].map((dx) => <rect key={`${dx}${dy}`} className="wheel" x={x + dx - 2.5} y={y + dy - 6} width={5} height={12} rx={2} />))}</>;
}

interface Props {
  family: AircraftFamily;
  components: Record<ComponentSlot, ComponentView>;
  selected: ComponentSlot;
  onSelect: (slot: ComponentSlot) => void;
}

export default function AircraftSilhouette({ family, components, selected, onSelect }: Props) {
  const [hovered, setHovered] = useState<ComponentSlot | null>(null);
  const tooltipId = useId();
  const g = GEOMETRY[family];
  const engines = engineShapes(g);
  const anchor = anchors(g, engines);
  const fuselage = fuselagePath(g);
  const finTop = g.stab.rootY - (g.tTail ? 6 : 26);

  const hotspot = (slot: ComponentSlot) => {
    const view = components[slot];
    return {
      role: "button",
      tabIndex: 0,
      "aria-label": `${componentLabel(slot, family)}: ${view.serialNumber ?? "no serial"}, ${view.health.replace("-", " ")}`,
      "aria-pressed": selected === slot,
      "aria-describedby": hovered === slot ? tooltipId : undefined,
      className: `part part-${slot} health-${view.health}${selected === slot ? " is-selected" : ""}${hovered === slot ? " is-hovered" : ""}`,
      onMouseEnter: () => setHovered(slot),
      onMouseLeave: () => setHovered((current) => current === slot ? null : current),
      onFocus: () => setHovered(slot),
      onBlur: () => setHovered((current) => current === slot ? null : current),
      onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation(); onSelect(slot); },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(slot); }
      },
    } as const;
  };

  const tip = hovered ? components[hovered] : null;
  const tipAnchor = hovered ? anchor[hovered] : null;

  return (
    <div className="silhouette">
      <svg viewBox={`0 0 ${W} ${H}`} className="silhouette-svg" role="group" aria-label={`Aircraft plan view. Select a component to see its extracted data.`}>
        <defs>
          <pattern id="blueprint-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" className="grid-line" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#blueprint-grid)" className="grid-bg" />
        <text x={CX} y={H - 6} className="axis-note" textAnchor="middle">PLAN VIEW · NOSE UP · LEFT = PORT</text>

        <g {...hotspot("Airframe")}>
          <path d={surfacePath(g.wing, g.hw)} className="surface" />
          <path d={surfacePath(g.stab, 2)} className="surface" />
          <path d={fuselage} className="surface fuselage" />
          <rect x={CX - 2.5} y={finTop} width={5} height={g.tailY - 10 - finTop} rx={2} className="fin" />
          <path d={`M${CX - g.hw * 0.55},${g.noseY + g.hw * 1.35} Q${CX},${g.noseY + g.hw * 0.85} ${CX + g.hw * 0.55},${g.noseY + g.hw * 1.35}`} className="windscreen" />
          {[-1, 1].map((sign) => <line key={sign} x1={CX + sign * g.hw * 0.62} x2={CX + sign * g.hw * 0.62} y1={g.noseY + g.hw * 3} y2={g.tailY - (g.tailY - g.noseY) * 0.24} className="windows" />)}
        </g>

        {engines.map((engine) => {
          const shape = (
            <>
              {g.engineMount === "rear" && <rect x={Math.min(engine.x, CX) + (engine.x < CX ? engine.w / 2 : -2)} y={engine.y + engine.len * 0.35} width={Math.abs(engine.x - CX) - engine.w / 2 + 2} height={engine.len * 0.3} className="pylon" />}
              <rect x={engine.x - engine.w / 2} y={engine.y} width={engine.w} height={engine.len} rx={engine.w / 2} className="nacelle" />
              <ellipse cx={engine.x} cy={engine.y + 5} rx={engine.w / 2 - 3} ry={3} className="intake" />
              {g.prop && <><line x1={engine.x - 30} x2={engine.x + 30} y1={engine.y - 2} y2={engine.y - 2} className="prop" /><circle cx={engine.x} cy={engine.y - 2} r={4} className="spinner" /></>}
              <text x={engine.x} y={engine.y + engine.len * 0.62} className="engine-number" textAnchor="middle">{engine.position}</text>
            </>
          );
          return engine.slot
            ? <g key={engine.position} {...hotspot(engine.slot)}>{shape}<rect x={engine.x - engine.w / 2 - 6} y={engine.y - 8} width={engine.w + 12} height={engine.len + 14} className="hit" /></g>
            : <g key={engine.position} className="part untracked" aria-hidden="true">{shape}</g>;
        })}

        <g {...hotspot("APU")}>
          <rect x={CX - 5} y={g.tailY - 22} width={10} height={16} rx={3} className="apu" />
          <circle cx={CX} cy={g.tailY - 3} r={2.5} className="apu-exhaust" />
          <circle cx={CX} cy={g.tailY - 12} r={15} className="hit" />
        </g>

        <g {...hotspot("LandingGearNose")}>
          <Wheels x={CX} y={g.noseGearY} bogie={false} />
          <circle cx={CX} cy={g.noseGearY} r={14} className="hit" />
        </g>
        {(["LandingGearLeft", "LandingGearRight"] as const).map((slot) => {
          const x = CX + (slot === "LandingGearLeft" ? -1 : 1) * g.mainGear.dx;
          return (
            <g key={slot} {...hotspot(slot)}>
              <Wheels x={x} y={g.mainGear.y} bogie={g.mainGear.bogie} />
              <circle cx={x} cy={g.mainGear.y} r={g.mainGear.bogie ? 19 : 14} className="hit" />
            </g>
          );
        })}
      </svg>

      {tip && tipAnchor && (
        <div
          id={tooltipId}
          role="tooltip"
          className={`part-tooltip ${tipAnchor.x > CX + 10 ? "flip" : ""}`}
          style={{ left: `${(tipAnchor.x / W) * 100}%`, top: `${(tipAnchor.y / H) * 100}%` }}
        >
          <div className="tooltip-head">
            <strong>{componentLabel(tip.slot, family)}</strong>
            <span className={`health-pill health-${tip.health}`}>{healthLabel(tip.health)}</span>
          </div>
          <p className="tooltip-serial">S/N <code>{tip.serialNumber ?? "not identified"}</code></p>
          {tip.health === "extracted" || tip.health === "low-confidence" ? (
            <dl className="tooltip-grid">
              <dt>TSN</dt><dd>{formatNumber(tip.tsn)}</dd>
              <dt>CSN</dt><dd>{formatNumber(tip.csn)}</dd>
              <dt>Hrs / month</dt><dd>{formatNumber(tip.monthlyHours)}</dd>
              <dt>Cyc / month</dt><dd>{formatNumber(tip.monthlyCycles)}</dd>
              {tip.derate && <><dt>Derate</dt><dd>{tip.derate}</dd></>}
              {tip.confidence !== null && <><dt>Confidence</dt><dd>{Math.round(tip.confidence * 100)}%</dd></>}
            </dl>
          ) : <p className="tooltip-reason">{tip.reason ?? "No data was extracted for this component."}</p>}
          <p className="tooltip-hint">Click for full details</p>
        </div>
      )}
    </div>
  );
}

export function healthLabel(health: ComponentView["health"]): string {
  return health === "extracted" ? "Extracted"
    : health === "low-confidence" ? "Low confidence"
    : health === "excluded" ? "Not validated"
    : "Not found";
}
