import { memo, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { CardWrapper } from "../ui/Card";

type ReportPeriod = "day" | "week" | "milestone";

interface ReportGeneratorCardProps {
  projectId: string | null;
}

export const ReportGeneratorCard = memo(function ReportGeneratorCard({ projectId }: ReportGeneratorCardProps) {
  const api = useApi();
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("week");

  async function handleGenerateReport() {
    if (!projectId) return;
    try {
      const report = await api.generateReport(projectId, reportPeriod);
      setReportText(report);
    } catch {
      setReportText("Failed to generate report.");
    }
  }

  return (
    <CardWrapper title="Generate Status Report">
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
        <select
          value={reportPeriod}
          onChange={(e) => setReportPeriod(e.target.value as ReportPeriod)}
          aria-label="Report period"
          style={{
            background: "var(--bg-tertiary)", border: "1px solid var(--border)",
            borderRadius: "4px", color: "var(--text-primary)", padding: "4px 8px", fontSize: "12px",
          }}
        >
          <option value="day">Last 24 hours</option>
          <option value="week">Last 7 days</option>
          <option value="milestone">Current milestone</option>
        </select>
        <button
          onClick={handleGenerateReport}
          disabled={!projectId}
          style={{
            background: "transparent", border: "1px solid var(--accent-blue)",
            color: "var(--accent-blue)", borderRadius: "6px", padding: "4px 12px",
            fontSize: "12px", cursor: projectId ? "pointer" : "not-allowed",
          }}
        >
          Generate Report
        </button>
        {reportText && (
          <button
            onClick={() => { navigator.clipboard.writeText(reportText); }}
            style={{
              background: "transparent", border: "1px solid var(--accent-green)",
              color: "var(--accent-green)", borderRadius: "6px", padding: "4px 12px",
              fontSize: "12px", cursor: "pointer",
            }}
          >
            Copy to Clipboard
          </button>
        )}
      </div>
      {reportText && (
        <pre style={{
          background: "var(--bg-tertiary)", border: "1px solid var(--border)",
          borderRadius: "6px", padding: "12px", fontSize: "11px",
          color: "var(--text-secondary)", whiteSpace: "pre-wrap",
          maxHeight: "300px", overflowY: "auto",
        }}>
          {reportText}
        </pre>
      )}
    </CardWrapper>
  );
});
