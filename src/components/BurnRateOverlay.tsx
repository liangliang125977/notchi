// v0.2 #2 — small capsule overlaid near the pet showing the current
// burn-rate snapshot ($X/h) and month-end projection vs. budget.
// Background colour is bucketed by `status` (calm / warm / hot /
// scorching). When there is no traffic at all today, the capsule
// hides itself rather than showing $0/h noise.

import { useBurnRate } from "../hooks/useBurnRate";
import "./BurnRateOverlay.css";

export function BurnRateOverlay() {
  const br = useBurnRate();
  if (!br) return null;
  // Hide when nothing has been spent today AND there is no live rate.
  if (br.usd_today < 0.001 && br.usd_per_min < 1e-6) return null;

  const usdPerH = br.usd_per_min * 60;
  const cls = `burn-capsule burn-${br.status}`;

  return (
    <div className={cls}>
      <span className="burn-rate">${usdPerH.toFixed(2)}/h</span>
      <span className="burn-sep">·</span>
      <span className="burn-projected">
        月底 ~${br.usd_projected_month.toFixed(0)} / ${br.usd_budget_month.toFixed(0)}
      </span>
    </div>
  );
}
