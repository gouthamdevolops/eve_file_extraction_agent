"use client";

import { useState } from "react";
import AircraftSilhouette, { healthLabel } from "@/components/aircraft-silhouette";
import {
  COMPONENT_SLOTS, FAMILY_LABELS, LOW_CONFIDENCE, componentLabel, formatNumber,
  type AircraftView, type ComponentSlot, type ComponentView,
} from "@/lib/aircraft-view";

function Meter({ value, label }: { value: number; label: string }) {
  const tone = value >= LOW_CONFIDENCE * 100 ? "high" : value > 0 ? "low" : "none";
  return (
    <span className={`meter meter-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

/** Shows the normalised number, plus the source formatting when it differs (e.g. 12345:30 hh:mm). */
function Measured({ value, raw }: { value: number | null; raw: string | null }) {
  const formatted = formatNumber(value);
  const showRaw = raw && raw.replace(/[,\s]/g, "") !== String(value);
  return <>{formatted}{showRaw && <small className="as-written"> as written “{raw}”</small>}</>;
}

function ComponentDetail({ view, family }: { view: ComponentView; family: AircraftView["family"] }) {
  const hasData = view.health === "extracted" || view.health === "low-confidence";
  return (
    <section className="component-detail" aria-live="polite" aria-labelledby="component-detail-heading">
      <div className="detail-head">
        <div>
          <p className="section-kicker">SELECTED COMPONENT</p>
          <h3 id="component-detail-heading">{componentLabel(view.slot, family)}</h3>
        </div>
        <span className={`health-pill health-${view.health}`}>{healthLabel(view.health)}</span>
      </div>
      <dl className="detail-grid">
        <dt>Serial number</dt><dd><code>{view.serialNumber ?? "Not identified"}</code></dd>
        <dt>Database check</dt><dd>{view.validation === "validated" ? "Serial matched a tracked record" : view.validation === "excluded" ? "Excluded" : "Not checked"}</dd>
        {hasData && <>
          <dt>Time since new (TSN)</dt><dd><Measured value={view.tsn} raw={view.tsnRaw} /></dd>
          <dt>Cycles since new (CSN)</dt><dd><Measured value={view.csn} raw={view.csnRaw} /></dd>
          <dt>Hours this month</dt><dd><Measured value={view.monthlyHours} raw={view.monthlyHoursRaw} /></dd>
          <dt>Cycles this month</dt><dd><Measured value={view.monthlyCycles} raw={view.monthlyCyclesRaw} /></dd>
          {view.slot.startsWith("Engine") && <><dt>Derate</dt><dd>{view.derate ?? "—"}</dd></>}
          <dt>Attachment</dt><dd>{view.attachmentStatus ?? "—"}</dd>
          <dt>Location / position</dt><dd>{view.location ?? "—"}</dd>
          <dt>Installed on</dt><dd>{view.currentAircraft ?? "—"}</dd>
          {view.confidence !== null && <><dt>Extraction confidence</dt><dd className="detail-meter"><Meter value={view.confidence * 100} label="Extraction confidence" />{Math.round(view.confidence * 100)}%</dd></>}
        </>}
      </dl>
      {view.reason && <p className={`detail-reason ${hasData ? "" : "warn"}`}>{view.reason}</p>}
      {view.health === "low-confidence" && <p className="detail-reason warn">Confidence is below {Math.round(LOW_CONFIDENCE * 100)}%. Check these values against the source document before relying on them.</p>}
    </section>
  );
}

export default function AircraftResults({ aircraft }: { aircraft: AircraftView[] }) {
  const [activeKey, setActiveKey] = useState(aircraft[0]?.key);
  const [selected, setSelected] = useState<ComponentSlot>("Engine1");
  const current = aircraft.find((item) => item.key === activeKey) ?? aircraft[0];
  if (!current) return null;

  const extractedCount = COMPONENT_SLOTS.filter((slot) => ["extracted", "low-confidence"].includes(current.components[slot].health)).length;

  return (
    <section className="aircraft-results" aria-labelledby="aircraft-heading">
      <div className="aircraft-heading">
        <div>
          <p className="section-kicker">EXTRACTED AIRCRAFT DATA</p>
          <h2 id="aircraft-heading">{current.registration?.value ?? current.msn?.value ?? "Aircraft"}</h2>
        </div>
        {aircraft.length > 1 && (
          <label className="document-select">
            <span>Document</span>
            <select value={current.key} onChange={(event) => setActiveKey(event.target.value)}>
              {aircraft.map((item) => <option key={item.key} value={item.key}>{item.registration?.value ? `${item.registration.value} — ` : ""}{item.sourceName}</option>)}
            </select>
          </label>
        )}
      </div>

      <dl className="identity-strip">
        <div><dt>Registration</dt><dd>{current.registration?.value ?? "—"}{current.registration?.tracked && <span className="tracked" title="Matched a tracked database record">✓</span>}</dd></div>
        <div><dt>MSN</dt><dd>{current.msn?.value ?? "—"}{current.msn?.tracked && <span className="tracked" title="Matched a tracked database record">✓</span>}</dd></div>
        <div><dt>Type</dt><dd>{current.aircraftType ?? "Not stated"}<small>{FAMILY_LABELS[current.family]}</small></dd></div>
        <div><dt>Reporting period</dt><dd>{current.reportingPeriod ?? "—"}</dd></div>
        <div><dt>Components</dt><dd>{extractedCount} / {COMPONENT_SLOTS.length}<small>with extracted data</small></dd></div>
      </dl>

      <ul className="summary-tiles" aria-label="Aircraft utilisation summary">
        {current.summary.map((field) => (
          <li key={field.name}>
            <span className="tile-label">{field.label}</span>
            <strong>{field.value ?? "Not found"}</strong>
            <span className="tile-confidence"><Meter value={field.confidence} label={`${field.label} confidence`} />{Math.round(field.confidence)}%</span>
          </li>
        ))}
      </ul>

      <div className="aircraft-stage">
        <AircraftSilhouette key={current.key} family={current.family} components={current.components} selected={selected} onSelect={setSelected} />
        <ComponentDetail view={current.components[selected]} family={current.family} />
      </div>

      <ul className="health-legend" aria-label="Legend">
        {(["extracted", "low-confidence", "excluded", "not-found"] as const).map((health) => <li key={health}><span className={`legend-swatch health-${health}`} />{healthLabel(health)}</li>)}
      </ul>

      <div className="component-table-wrap">
        <table className="component-table">
          <caption>All components · {current.sourceName}</caption>
          <thead><tr><th scope="col">Component</th><th scope="col">Serial</th><th scope="col">Status</th><th scope="col">TSN</th><th scope="col">CSN</th><th scope="col">Hrs / mo</th><th scope="col">Cyc / mo</th></tr></thead>
          <tbody>
            {COMPONENT_SLOTS.map((slot) => {
              const view = current.components[slot];
              return (
                <tr key={slot} className={slot === selected ? "is-selected" : ""}>
                  <th scope="row"><button type="button" className="row-select" onClick={() => setSelected(slot)} aria-pressed={slot === selected}>{componentLabel(slot, current.family)}</button></th>
                  <td><code>{view.serialNumber ?? "—"}</code></td>
                  <td><span className={`health-pill health-${view.health}`}>{healthLabel(view.health)}</span></td>
                  <td>{formatNumber(view.tsn)}</td>
                  <td>{formatNumber(view.csn)}</td>
                  <td>{formatNumber(view.monthlyHours)}</td>
                  <td>{formatNumber(view.monthlyCycles)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
