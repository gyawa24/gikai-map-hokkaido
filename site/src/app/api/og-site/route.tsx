import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, #0F1A2F 0%, #1B3A6B 48%, #243B6B 100%)",
          color: "#FFFFFF",
          padding: "56px 64px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontSize: "24px",
              fontWeight: 700,
            }}
          >
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "999px",
                background: "#F7C948",
              }}
            />
            地方議会ドットコムγ
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 14px",
              borderRadius: "999px",
              background: "#F7C948",
              color: "#1B3A6B",
              fontSize: "22px",
              fontWeight: 800,
            }}
          >
            γ
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div
            style={{
              display: "flex",
              fontSize: "68px",
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              maxWidth: "900px",
            }}
          >
            北海道内の地方議会情報を、
            <br />
            横断的に見える形へ。
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: "920px",
              fontSize: "30px",
              lineHeight: 1.5,
              color: "#D9E7FF",
            }}
          >
            議員情報、議事録、議決結果を一つの入口からたどれる
            市民向け情報サイト。
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "24px",
            color: "#D9E7FF",
          }}
        >
          <div style={{ display: "flex" }}>https://chihougikai.com</div>
          <div style={{ display: "flex" }}>議員・議事録・議決</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
