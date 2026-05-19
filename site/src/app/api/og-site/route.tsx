import { ImageResponse } from "next/og";

export const runtime = "nodejs";

function ArchiveMark({ size = 120 }: { size?: number }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: size,
        height: size,
        border: "4px solid #cbd5e0",
        borderRadius: 24,
        background: "#ffffff",
      }}
    >
      <div style={{ position: "absolute", left: 42, top: 0, width: 26, height: 6, borderRadius: 999, background: "#2f3b52", transform: "rotate(38deg)" }} />
      <div style={{ position: "absolute", right: 42, top: 0, width: 26, height: 6, borderRadius: 999, background: "#2f3b52", transform: "rotate(-38deg)" }} />
      <div style={{ position: "absolute", left: 12, top: 16, right: 12, bottom: 28, border: "3px solid #cbd5e0", borderRadius: 14, background: "#ffffff" }} />
      <div style={{ position: "absolute", left: 24, top: 28, right: 24, height: 58, border: "2px solid #d9dfe8", borderRadius: 9, background: "#f7f9fc" }} />
      <div style={{ position: "absolute", left: 40, top: 42, width: 68, height: 35, border: "4px solid #1b3a6b", borderRadius: 8, background: "#ffffff" }} />
      <div style={{ position: "absolute", left: 58, top: 58, width: 9, height: 9, borderRadius: 999, background: "#1b3a6b" }} />
      <div style={{ position: "absolute", left: 88, top: 58, width: 9, height: 9, borderRadius: 999, background: "#1b3a6b" }} />
      <div style={{ position: "absolute", left: 60, top: 72, width: 36, height: 6, borderRadius: 999, background: "#1f78bd" }} />
      <div style={{ position: "absolute", left: 35, top: 89, right: 35, height: 5, borderRadius: 999, background: "#1f78bd" }} />
      {[42, 58, 74, 90].map((left) => (
        <div key={left} style={{ position: "absolute", left, top: 91, width: 9, height: 13, borderRadius: 2, background: "#2f3b52" }} />
      ))}
      <div style={{ position: "absolute", left: 34, right: 34, top: 106, height: 5, borderRadius: 999, background: "#2f3b52" }} />
      <div style={{ position: "absolute", left: 29, right: 29, top: 116, height: 5, borderRadius: 999, background: "#2f3b52" }} />
      <div style={{ position: "absolute", left: 54, right: 54, bottom: 8, height: 14, border: "3px solid #cbd5e0", borderRadius: 3, background: "#ffffff" }} />
      <div style={{ position: "absolute", right: 20, top: 26, width: 34, height: 34, border: "3px solid #1f78bd", borderRadius: 999, background: "#e9f5ff", color: "#1f78bd", fontSize: 20, fontWeight: 900, alignItems: "center", justifyContent: "center" }}>
        γ
      </div>
    </div>
  );
}

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
          background: "#f4f6f9",
          color: "#111827",
          padding: "46px 58px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "34px 38px",
            display: "flex",
            flexDirection: "column",
            borderTop: "1px solid #d7dee8",
            borderLeft: "1px solid #d7dee8",
            opacity: 0.72,
          }}
        >
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                height: "78px",
                borderBottom: "1px solid #d7dee8",
              }}
            >
              <div style={{ width: "30%", borderRight: "1px solid #d7dee8" }} />
              <div style={{ width: "34%", borderRight: "1px solid #d7dee8" }} />
              <div style={{ width: "36%" }} />
            </div>
          ))}
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: "2px solid #cbd5e0",
            background: "#ffffff",
          }}
        >
          <div style={{ display: "flex", width: "30%", justifyContent: "center", padding: "14px 20px", color: "#5a5f9d", fontSize: 28, fontWeight: 700 }}>
            - Archive -
          </div>
          <div style={{ display: "flex", width: "38%", justifyContent: "center", borderLeft: "2px solid #d7dee8", borderRight: "2px solid #d7dee8", padding: "14px 20px", color: "#1f78bd", fontSize: 30, fontWeight: 900 }}>
            地方議会ドットコム（γ）
          </div>
          <div style={{ display: "flex", width: "32%", justifyContent: "center", padding: "14px 16px", color: "#2f3b52", fontSize: 23, fontWeight: 700 }}>
            DOTTOKOMU
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 34,
            border: "2px solid #cbd5e0",
            borderRadius: 28,
            background: "rgba(255, 255, 255, 0.94)",
            padding: "48px 52px",
            boxShadow: "0 16px 34px rgba(27, 58, 107, 0.08)",
          }}
        >
          <ArchiveMark size={132} />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", color: "#1f78bd", fontFamily: "Arial, sans-serif", fontSize: 24, fontWeight: 800, letterSpacing: 3 }}>
              CHIHOU GIKAI DOTTOKOMU
            </div>
            <div style={{ display: "flex", fontSize: 66, fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.02em", color: "#0f172a" }}>
              議会をもっと読みやすく。
            </div>
            <div style={{ display: "flex", maxWidth: 770, fontSize: 27, lineHeight: 1.45, color: "#475569" }}>
              議員・議事録・議決・予算を、公式資料に戻れる形で横断検索。
            </div>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: "2px solid #1b3a6b",
            background: "#123461",
            color: "#ffffff",
            padding: "18px 28px",
            fontSize: 26,
            fontWeight: 800,
          }}
        >
          <div style={{ display: "flex" }}>https://chihougikai.com</div>
          <div style={{ display: "flex", color: "#d8e8ff" }}>北海道から、地方議会の記録をたどる</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
