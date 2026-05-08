import { demo } from "../data";
import { colors, fontFamily, lift } from "../styles";
import type { CSSProperties } from "react";

interface DashboardMockProps {
  progress: number;
}

const bars = [34, 42, 28, 58, 76, 92, 70, 48, 62, 38, 28, 46];

export function DashboardMock({ progress }: DashboardMockProps) {
  return (
    <div
      style={{
        position: "absolute",
        right: 150,
        top: 188,
        width: 620,
        borderRadius: 34,
        background: "rgba(247,250,255,0.94)",
        boxShadow: "0 34px 110px rgba(0,0,0,0.42)",
        color: "#111827",
        fontFamily,
        opacity: progress,
        overflow: "hidden",
        transform: `${lift(progress, 34)} scale(${0.96 + progress * 0.04})`,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: "1px solid rgba(15,23,42,0.08)",
          display: "flex",
          justifyContent: "space-between",
          padding: "28px 32px 18px",
        }}
      >
        <div>
          <div style={{ color: "#64748b", fontSize: 18, fontWeight: 700 }}>
            Today
          </div>
          <div style={{ fontSize: 42, fontWeight: 850 }}>Notchi</div>
        </div>
        <div
          style={{
            borderRadius: 999,
            background: "#0f172a",
            color: "white",
            fontSize: 16,
            fontWeight: 800,
            padding: "10px 16px",
          }}
        >
          Local
        </div>
      </div>
      <div style={{ display: "grid", gap: 16, padding: 28 }}>
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(3, 1fr)",
          }}
        >
          <Metric label="Tokens" value={demo.tokens} accent={colors.cyan} />
          <Metric label="Cost" value={demo.cost} accent={colors.green} />
          <Metric label="Model" value={demo.model} accent={colors.warm} />
        </div>
        <section style={panelStyle}>
          <Header title="Hourly flow" />
          <div
            style={{ alignItems: "end", display: "flex", gap: 11, height: 130 }}
          >
            {bars.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: h,
                  borderRadius: "10px 10px 4px 4px",
                  background:
                    i >= 4 && i <= 7
                      ? "linear-gradient(180deg,#5ac8fa,#30d158)"
                      : "rgba(15,23,42,0.16)",
                }}
              />
            ))}
          </div>
        </section>
        <div
          style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}
        >
          <MiniList
            title="Tools"
            rows={["Claude Code", "Codex", "Claude Desktop"]}
          />
          <MiniList
            title="Growth"
            rows={["Hatchling", "Content", "+10 feed"]}
          />
        </div>
      </div>
    </div>
  );
}

function Metric({
  accent,
  label,
  value,
}: {
  accent: string;
  label: string;
  value: string;
}) {
  return (
    <div style={{ ...panelStyle, padding: 18 }}>
      <div style={{ color: "#64748b", fontSize: 15, fontWeight: 700 }}>
        {label}
      </div>
      <div
        style={{ color: accent, fontSize: 30, fontWeight: 850, marginTop: 8 }}
      >
        {value}
      </div>
    </div>
  );
}

function Header({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 16 }}>
      {title}
    </div>
  );
}

function MiniList({ rows, title }: { rows: string[]; title: string }) {
  return (
    <section style={panelStyle}>
      <Header title={title} />
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((row, i) => (
          <div
            key={row}
            style={{ alignItems: "center", display: "flex", gap: 10 }}
          >
            <div
              style={{
                height: 8,
                width: `${92 - i * 18}%`,
                borderRadius: 999,
                background: i === 0 ? colors.cyan : "rgba(15,23,42,0.18)",
              }}
            />
            <span style={{ color: "#475569", fontSize: 14, fontWeight: 700 }}>
              {row}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const panelStyle = {
  background: "rgba(15,23,42,0.055)",
  border: "1px solid rgba(15,23,42,0.075)",
  borderRadius: 22,
  padding: 20,
} satisfies CSSProperties;
