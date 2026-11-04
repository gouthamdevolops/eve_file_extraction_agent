import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AircraftResults from "@/components/aircraft-results";
import { aircraftFamily, buildAircraftViews } from "@/lib/aircraft-view";
import { pipelineResult } from "./fixtures/pipeline-result";

afterEach(cleanup);

describe("aircraftFamily", () => {
  it.each([
    ["A320-214", "narrowbody"], ["Boeing 737-800", "narrowbody"], ["B38M", "narrowbody"], ["E190", "narrowbody"], ["A220-300", "narrowbody"],
    ["A350-941", "widebody"], ["B787-9", "widebody"], ["777-300ER", "widebody"], ["A330-243", "widebody"],
    ["A340-313", "widebody-quad"], ["Boeing 747-400", "widebody-quad"],
    ["CRJ-900", "regional-rear"], ["ERJ-145", "regional-rear"], ["MD-83", "regional-rear"],
    ["ATR 72-600", "turboprop"], ["DHC-8-402", "turboprop"], ["Q400", "turboprop"],
    ["Not found", "unknown"], [null, "unknown"],
  ])("classifies %s as %s", (type, family) => {
    expect(aircraftFamily(type)).toBe(family);
  });
});

describe("buildAircraftViews", () => {
  const [view] = buildAircraftViews(pipelineResult);

  it("returns one view per completed extraction with identity and type", () => {
    expect(buildAircraftViews(pipelineResult)).toHaveLength(1);
    expect(view.registration).toEqual({ type: "registration", value: "G-EVEA", tracked: true });
    expect(view.msn?.value).toBe("5123");
    expect(view.aircraftType).toBe("A320-214");
    expect(view.family).toBe("narrowbody");
    expect(view.reportingPeriod).toBe("August 2026");
    expect(view.sourceName).toBe("G-EVEA_AUG2026.pdf");
    expect(view.summary.map((field) => field.name)).not.toContain("aircraft_type");
  });

  it("derives component health from validation, availability and confidence", () => {
    expect(view.components.Engine1.health).toBe("extracted");
    expect(view.components.Engine1.derate).toBe("10%");
    expect(view.components.Engine2.health).toBe("low-confidence");
    expect(view.components.APU.health).toBe("excluded");
    expect(view.components.APU.tsn).toBeNull();
    expect(view.components.LandingGearNose.health).toBe("not-found");
  });

  it("keeps document values for components whose serial was not validated", () => {
    const gear = view.components.LandingGearRight;
    expect(gear.health).toBe("excluded");
    expect(gear.hasValues).toBe(true);
    expect(gear.tsn).toBe(11800);
    expect(gear.serialNumber).toBe("MLG-R-9999");
  });

  it("never carries source paths or raw excerpts into the view", () => {
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("/data/");
    expect(serialized).not.toContain("SECRET EXCERPT");
  });

  it("tolerates malformed results", () => {
    expect(buildAircraftViews(null)).toEqual([]);
    expect(buildAircraftViews({ extractionResults: "nope" })).toEqual([]);
  });
});

describe("AircraftResults", () => {
  it("shows engine details on hover and pins details on click", () => {
    const { container } = render(<AircraftResults aircraft={buildAircraftViews(pipelineResult)} />);
    expect(screen.getByRole("heading", { name: "G-EVEA" })).toBeTruthy();

    const engine2 = container.querySelector(".part-Engine2")!;
    fireEvent.mouseEnter(engine2);
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("Engine 2 (right)")).toBeTruthy();
    expect(within(tooltip).getByText("ESN-779544")).toBeTruthy();
    expect(within(tooltip).getByText("28,750")).toBeTruthy();
    fireEvent.mouseLeave(engine2);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(container.querySelector(".part-APU")!);
    const detail = screen.getByRole("heading", { name: "APU", level: 3 }).closest("section")!;
    expect(within(detail).getByText(/APU-0099 has no unique tracked component/)).toBeTruthy();
  });

  it("lets keyboard users select components", () => {
    const { container } = render(<AircraftResults aircraft={buildAircraftViews(pipelineResult)} />);
    const gear = container.querySelector(".part-LandingGearLeft")!;
    fireEvent.focus(gear);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(gear, { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Left main landing gear", level: 3 })).toBeTruthy();
  });
});
