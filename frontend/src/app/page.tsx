"use client";

import { useState, useRef } from "react";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type CitedLaw = {
  law_name: string;
  article_no: string;
  verified: boolean;
};

type AnalysisResult = {
  verdict: string;
  reasoning: string;
  summary: string;
  cited_laws: CitedLaw[];
};

type ClauseResult = AnalysisResult & { clause_text: string };

type PdfAnalysisResult = { clauses: ClauseResult[] };

// ── 판정 설정 ─────────────────────────────────────────────────────────────────

const VERDICT_CONFIG = {
  즉시거절:    { emoji: "🔴", label: "즉시 거절",      color: "#c0392b", bg: "#fff0f0", border: "#f5c6c6" },
  협상가능:    { emoji: "🟡", label: "협상 가능",      color: "#b7791f", bg: "#fffbea", border: "#f6e58d" },
  법무검토필요: { emoji: "🟢", label: "법무 검토 필요", color: "#276749", bg: "#f0fff4", border: "#b7dfc9" },
};

const FALLBACK_CONFIG = { emoji: "⚪", label: "알 수 없음", color: "#555", bg: "#f5f5f5", border: "#ddd" };

function getVerdictConfig(verdict: string) {
  if (verdict?.includes("즉시 거절")) return VERDICT_CONFIG["즉시거절"];
  if (verdict?.includes("협상 가능"))  return VERDICT_CONFIG["협상가능"];
  if (verdict?.includes("법무 검토"))  return VERDICT_CONFIG["법무검토필요"];
  return VERDICT_CONFIG[verdict as keyof typeof VERDICT_CONFIG] ?? FALLBACK_CONFIG;
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function Home() {
  const [mode, setMode] = useState<"text" | "pdf">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [textResult, setTextResult] = useState<AnalysisResult | PdfAnalysisResult | null>(null);
  const [pdfResult, setPdfResult] = useState<PdfAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setPdfResult(null);
    setError(null);
  }

  function handleModeChange(next: "text" | "pdf") {
    setMode(next);
    setTextResult(null);
    setPdfResult(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setTextResult(null);
    setPdfResult(null);
    setError(null);

    try {
      let res: Response;

      if (mode === "text") {
        res = await fetch("http://localhost:8000/analyze/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else {
        const formData = new FormData();
        formData.append("file", file!);
        res = await fetch("http://localhost:8000/analyze", {
          method: "POST",
          body: formData,
        });
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? "분석 중 오류가 발생했습니다.");
      }

      const data = await res.json();
      if (mode === "text") {
        setTextResult(data);
      } else {
        setPdfResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = !loading && (mode === "text" ? text.trim().length > 0 : file !== null);

  return (
    <main style={s.main}>
      <h1 style={s.title}>사인전에</h1>
      <p style={s.subtitle}>근로계약서 조항을 입력하면 독소조항 여부를 분석해드립니다.</p>

      {/* 탭 */}
      <div style={s.tabs}>
        {(["text", "pdf"] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            style={{ ...s.tab, ...(mode === m ? s.tabActive : {}) }}
          >
            {m === "text" ? "텍스트 입력" : "PDF 업로드"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={s.form}>
        {mode === "text" ? (
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setTextResult(null); setError(null); }}
            placeholder="근로계약서 조항을 붙여넣으세요..."
            style={s.textarea}
            rows={8}
          />
        ) : (
          <div style={s.dropzone} onClick={() => inputRef.current?.click()}>
            {file ? (
              <span style={{ color: "#333" }}>{file.name}</span>
            ) : (
              <span>클릭하여 PDF 파일 선택</span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </div>
        )}

        <button type="submit" disabled={!canSubmit} style={{ ...s.button, ...(!canSubmit ? s.buttonDisabled : {}) }}>
          {loading ? <span style={s.spinner} /> : null}
          {loading ? "분석 중..." : "분석하기"}
        </button>
      </form>

      {error && <div style={s.errorBox}>{error}</div>}

      {/* 텍스트 입력 결과 — 조항 분리됐으면 카드 목록, 아니면 단일 카드 */}
      {textResult && "clauses" in textResult ? (
        <div style={s.clauseList}>
          <p style={s.clauseCount}>총 {(textResult as PdfAnalysisResult).clauses.length}개 조항 분석 완료</p>
          {(textResult as PdfAnalysisResult).clauses.map((clause, i) => (
            <ClauseCard key={i} index={i + 1} clause={clause} />
          ))}
        </div>
      ) : textResult ? (
        <ResultCard result={textResult as AnalysisResult} />
      ) : null}

      {/* PDF 결과 — 조항별 카드 목록 */}
      {pdfResult && (
        <div style={s.clauseList}>
          <p style={s.clauseCount}>총 {pdfResult.clauses.length}개 조항 분석 완료</p>
          {pdfResult.clauses.map((clause, i) => (
            <ClauseCard key={i} index={i + 1} clause={clause} />
          ))}
        </div>
      )}
    </main>
  );
}

// ── 텍스트 결과 카드 (단일) ───────────────────────────────────────────────────

function ResultCard({ result }: { result: AnalysisResult }) {
  console.log("verdict from backend:", result.verdict);

  const [devOpen, setDevOpen] = useState(false);
  const cfg = getVerdictConfig(result.verdict);
  const verifiedLaws = (result.cited_laws ?? []).filter((l) => l.verified);

  return (
    <div style={s.card}>
      <div style={{ ...s.verdictBadge, background: cfg.bg, border: `1.5px solid ${cfg.border}`, color: cfg.color }}>
        <span style={s.verdictEmoji}>{cfg.emoji}</span>
        <span style={s.verdictLabel}>{cfg.label}</span>
      </div>

      <section style={s.section}>
        <h3 style={s.sectionTitle}>이유</h3>
        <p style={s.sectionBody}>{result.summary}</p>
      </section>

      {verifiedLaws.length > 0 && (
        <section style={s.section}>
          <h3 style={s.sectionTitle}>법령 근거</h3>
          <ul style={s.lawList}>
            {verifiedLaws.map((l, i) => (
              <li key={i} style={s.lawItem}>
                <span style={s.lawName}>{`${l.law_name} ${l.article_no}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={s.section}>
        <button onClick={() => setDevOpen((v) => !v)} style={s.devButton}>
          {devOpen ? "▲ 백엔드 응답 원문 닫기" : "▼ 백엔드 응답 원문 보기 (개발자용)"}
        </button>
        {devOpen && <pre style={s.devPre}>{JSON.stringify(result, null, 2)}</pre>}
      </section>
    </div>
  );
}

// ── PDF 조항별 카드 ───────────────────────────────────────────────────────────

function ClauseCard({ index, clause }: { index: number; clause: ClauseResult }) {
  const [expanded, setExpanded] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const cfg = getVerdictConfig(clause.verdict);
  const verifiedLaws = (clause.cited_laws ?? []).filter((l) => l.verified);

  return (
    <div style={s.card}>
      {/* 헤더: 조항 번호 + 판정 배지 */}
      <div
        style={{ ...s.clauseHeader, background: cfg.bg, border: `1.5px solid ${cfg.border}`, cursor: "pointer" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ ...s.clauseIndex, color: cfg.color }}>조항 {index}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 18 }}>{cfg.emoji}</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
        </div>
        <span style={{ marginLeft: "auto", color: cfg.color, fontSize: 13 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* 조항 원문 */}
      {expanded && (
        <>
          <section style={s.section}>
            <h3 style={s.sectionTitle}>원문</h3>
            <p style={{ ...s.sectionBody, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{clause.clause_text}</p>
          </section>

          <section style={s.section}>
            <h3 style={s.sectionTitle}>이유</h3>
            <p style={s.sectionBody}>{clause.summary}</p>
          </section>

          {verifiedLaws.length > 0 && (
            <section style={s.section}>
              <h3 style={s.sectionTitle}>법령 근거</h3>
              <ul style={s.lawList}>
                {verifiedLaws.map((l, i) => (
                  <li key={i} style={s.lawItem}>
                    <span style={s.lawName}>{`${l.law_name} ${l.article_no}`}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section style={s.section}>
            <button onClick={() => setDevOpen((v) => !v)} style={s.devButton}>
              {devOpen ? "▲ 백엔드 응답 원문 닫기" : "▼ 백엔드 응답 원문 보기 (개발자용)"}
            </button>
            {devOpen && <pre style={s.devPre}>{JSON.stringify(clause, null, 2)}</pre>}
          </section>
        </>
      )}
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 680,
    margin: "72px auto",
    padding: "0 24px",
    fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
  },
  title: { fontSize: 28, fontWeight: 700, marginBottom: 6, color: "#111" },
  subtitle: { fontSize: 15, color: "#666", marginBottom: 28 },
  tabs: { display: "flex", gap: 8, marginBottom: 16 },
  tab: {
    padding: "8px 18px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "#fff",
    fontSize: 14,
    cursor: "pointer",
    color: "#555",
  },
  tabActive: {
    border: "1px solid #0070f3",
    color: "#0070f3",
    fontWeight: 600,
    background: "#f0f6ff",
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  textarea: {
    width: "100%",
    padding: "14px 16px",
    border: "1px solid #ddd",
    borderRadius: 8,
    fontSize: 14,
    color: "#222",
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
    lineHeight: 1.6,
  },
  dropzone: {
    border: "2px dashed #ccc",
    borderRadius: 8,
    padding: "44px 24px",
    textAlign: "center",
    cursor: "pointer",
    color: "#888",
    fontSize: 14,
  },
  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "13px 0",
    backgroundColor: "#0070f3",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  buttonDisabled: { backgroundColor: "#b0c8f0", cursor: "not-allowed" },
  spinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    border: "2px solid rgba(255,255,255,0.4)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  },
  errorBox: {
    marginTop: 20,
    padding: "14px 16px",
    backgroundColor: "#fff0f0",
    border: "1px solid #f5c6c6",
    borderRadius: 8,
    color: "#c0392b",
    fontSize: 14,
  },
  clauseList: { marginTop: 28, display: "flex", flexDirection: "column", gap: 12 },
  clauseCount: { fontSize: 13, color: "#888", marginBottom: 4 },
  card: {
    border: "1px solid #e8e8e8",
    borderRadius: 12,
    overflow: "hidden",
  },
  verdictBadge: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "20px 24px",
  },
  verdictEmoji: { fontSize: 28, lineHeight: 1 },
  verdictLabel: { fontSize: 22, fontWeight: 700 },
  clauseHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 20px",
  },
  clauseIndex: { fontSize: 13, fontWeight: 600 },
  section: { padding: "16px 24px", borderTop: "1px solid #f0f0f0" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 8,
  },
  sectionBody: { fontSize: 14, color: "#333", lineHeight: 1.7, margin: 0 },
  lawList: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 },
  lawItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  lawName: { color: "#444", fontWeight: 500 },
  devButton: { fontSize: 12, color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0 },
  devPre: {
    marginTop: 10,
    padding: 12,
    background: "#f6f8fa",
    border: "1px solid #e1e4e8",
    borderRadius: 6,
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    color: "#333",
  },
};
