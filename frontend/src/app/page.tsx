"use client";

import { useState, useRef, useEffect } from "react";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type CitedLaw = {
  law_name: string;
  article_no: string;
  verified: boolean;
};

type ClauseResult = {
  clause_text: string;
  verdict: string;
  verdict_code: string;
  reasoning: string;
  summary: string;
  cited_laws: CitedLaw[];
};

// ── 판정 설정 ─────────────────────────────────────────────────────────────────

const VERDICT = {
  즉시거절: {
    label: "즉시 거절", emoji: "🔴", color: "#ef4444",
    bg: "rgba(239,68,68,0.15)", border: "#ef4444",
    badgeBg: "#fef2f2", badgeColor: "#dc2626",
  },
  협상가능: {
    label: "협상 가능", emoji: "🟡", color: "#ca8a04",
    bg: "rgba(234,179,8,0.15)", border: "#eab308",
    badgeBg: "#fefce8", badgeColor: "#ca8a04",
  },
  법무검토필요: {
    label: "법무 검토 필요", emoji: "🔵", color: "#64748b",
    bg: "rgba(100,116,139,0.1)", border: "#cbd5e1",
    badgeBg: "#f1f5f9", badgeColor: "#64748b",
  },
  문제없음: {
    label: "문제 없음", emoji: "🟢", color: "#16a34a",
    bg: "rgba(34,197,94,0.12)", border: "#86efac",
    badgeBg: "#f0fdf4", badgeColor: "#16a34a",
  },
};

const FALLBACK = {
  label: "알 수 없음", emoji: "⚪", color: "#64748b",
  bg: "rgba(148,163,184,0.15)", border: "#94a3b8",
  badgeBg: "#f8fafc", badgeColor: "#64748b",
};

function getV(verdict: string) {
  if (verdict?.includes("즉시")) return VERDICT["즉시거절"];
  if (verdict?.includes("협상")) return VERDICT["협상가능"];
  if (verdict?.includes("법무") || verdict?.includes("검토")) return VERDICT["법무검토필요"];
  if (verdict?.includes("문제없음") || verdict?.includes("문제 없음")) return VERDICT["문제없음"];
  return VERDICT[verdict as keyof typeof VERDICT] ?? FALLBACK;
}


const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── 메인 ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [mode, setMode] = useState<"text" | "pdf">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [clauses, setClauses] = useState<ClauseResult[] | null>(null);
  const [originalText, setOriginalText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setClauses(null);
    setError(null);
    setSelectedIndex(0);

    try {
      let res: Response;
      if (mode === "text") {
        res = await fetch(`${API_URL}/analyze/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } else {
        const formData = new FormData();
        formData.append("file", file!);
        res = await fetch(`${API_URL}/analyze`, { method: "POST", body: formData });
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? "분석 중 오류가 발생했습니다.");
      }

      const data = await res.json();
      const resolvedOriginal = data.original_text ?? text;
      setOriginalText(resolvedOriginal);

      if (data.clauses) {
        setClauses(data.clauses);
      } else {
        setClauses([{ clause_text: resolvedOriginal, ...data }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setClauses(null);
    setOriginalText("");
    setError(null);
    setText("");
    setFile(null);
    setSelectedIndex(0);
    setDevOpen(false);
  }

  return (
    <div style={s.root}>
      {/* 헤더 */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={s.logo}>사인전에</span>
            <span style={s.headerDesc}>근로계약서 AI 독소조항 탐지</span>
          </div>
          {clauses && (
            <button onClick={handleReset} style={s.resetBtn}>
              ← 다시 분석하기
            </button>
          )}
        </div>
      </header>

      <main style={s.main}>
        {!clauses ? (
          /* ── 입력 화면 ── */
          <div style={s.inputWrap}>
            <div style={s.inputCard}>
              <h2 style={s.inputTitle}>근로계약서를 분석해드립니다</h2>
              <p style={s.inputSubtitle}>
                조항을 붙여넣거나 PDF를 업로드하면 AI가 독소조항 여부를 판정합니다.
              </p>

              <div style={s.tabs}>
                {(["text", "pdf"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setError(null); }}
                    style={{ ...s.tab, ...(mode === m ? s.tabActive : {}) }}
                  >
                    {m === "text" ? "텍스트 입력" : "PDF 업로드"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit}>
                {mode === "text" ? (
                  <textarea
                    value={text}
                    onChange={(e) => { setText(e.target.value); setError(null); }}
                    placeholder="근로계약서 조항을 붙여넣으세요..."
                    style={s.textarea}
                    rows={10}
                  />
                ) : (
                  <div style={s.dropzone} onClick={() => inputRef.current?.click()}>
                    {file ? (
                      <>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
                        <div style={{ color: "#1e293b", fontWeight: 600, fontSize: 15 }}>{file.name}</div>
                        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>클릭하여 다른 파일 선택</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
                        <div style={{ color: "#475569", fontSize: 15 }}>클릭하여 PDF 파일 선택</div>
                        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>PDF 형식만 지원</div>
                      </>
                    )}
                    <input
                      ref={inputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                      style={{ display: "none" }}
                    />
                  </div>
                )}

                {error && <div style={s.errorBox}>{error}</div>}

                <button
                  type="submit"
                  disabled={loading || (mode === "text" ? !text.trim() : !file)}
                  style={{
                    ...s.submitBtn,
                    ...(loading || (mode === "text" ? !text.trim() : !file) ? s.submitBtnDisabled : {}),
                  }}
                >
                  {loading ? (
                    <>
                      <span style={s.spinner} />
                      AI가 법령을 검토하고 있습니다...
                    </>
                  ) : "분석하기"}
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* ── 결과 화면 ── */
          <ResultScreen
            clauses={clauses}
            originalText={originalText}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            devOpen={devOpen}
            onToggleDev={() => setDevOpen((v) => !v)}
          />
        )}
      </main>
    </div>
  );
}

// ── 원문 하이라이팅 세그먼트 빌더 ────────────────────────────────────────────

type Segment = { text: string; clauseIndex: number | null };

function buildSegments(originalText: string, clauses: ClauseResult[]): Segment[] {
  const positions: { start: number; end: number; clauseIndex: number }[] = [];

  for (let i = 0; i < clauses.length; i++) {
    const idx = originalText.indexOf(clauses[i].clause_text);
    if (idx !== -1) {
      positions.push({ start: idx, end: idx + clauses[i].clause_text.length, clauseIndex: i });
    }
  }

  positions.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const pos of positions) {
    if (pos.start < cursor) continue; // 겹치는 구간 스킵
    if (pos.start > cursor) {
      segments.push({ text: originalText.slice(cursor, pos.start), clauseIndex: null });
    }
    segments.push({ text: originalText.slice(pos.start, pos.end), clauseIndex: pos.clauseIndex });
    cursor = pos.end;
  }

  if (cursor < originalText.length) {
    segments.push({ text: originalText.slice(cursor), clauseIndex: null });
  }

  return segments;
}

// ── 결과 화면 ─────────────────────────────────────────────────────────────────

function ResultScreen({
  clauses, originalText, selectedIndex, onSelect, devOpen, onToggleDev,
}: {
  clauses: ClauseResult[];
  originalText: string;
  selectedIndex: number;
  onSelect: (i: number) => void;
  devOpen: boolean;
  onToggleDev: () => void;
}) {
  const selected = clauses[selectedIndex];
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const item = itemRefs.current[selectedIndex];
    const list = listRef.current;
    if (item && list) {
      list.scrollTop = item.offsetTop - list.offsetTop;
    }
  }, [selectedIndex]);

  const counts = {
    즉시거절: clauses.filter((c) => c.verdict?.includes("즉시")).length,
    협상가능: clauses.filter((c) => c.verdict?.includes("협상")).length,
    법무검토필요: clauses.filter((c) => c.verdict?.includes("법무") || c.verdict?.includes("검토")).length,
  };

  const segments = buildSegments(originalText, clauses);

  return (
    <div className="result-layout" style={s.resultLayout}>
      {/* 왼쪽 패널 — 원문 + 인라인 하이라이팅 */}
      <div style={s.leftPanel}>
        <p style={s.panelLabel}>원문 분석</p>
        <div style={s.originalTextBox}>
          {segments.map((seg, i) => {
            if (seg.clauseIndex === null) {
              return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{seg.text}</span>;
            }
            const clause = clauses[seg.clauseIndex];
            const v = getV(clause.verdict);
            const isSelected = seg.clauseIndex === selectedIndex;
            return (
              <span
                key={i}
                onClick={() => onSelect(seg.clauseIndex!)}
                style={{
                  background: v.bg,
                  borderBottom: `2px solid ${v.border}`,
                  borderRadius: 3,
                  cursor: "pointer",
                  whiteSpace: "pre-wrap",
                  outline: isSelected ? `2px solid ${v.color}` : "none",
                  outlineOffset: 1,
                  padding: "1px 0",
                }}
              >
                {seg.text}
              </span>
            );
          })}
        </div>
      </div>

      {/* 오른쪽 패널 */}
      <div className="right-panel" style={s.rightPanel}>
        {/* 요약 카드 */}
        <div style={s.card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 12 }}>
            총 {clauses.length}개 조항 분석 완료
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {counts.즉시거절 > 0 && (
              <span style={{ ...s.countBadge, background: "#fef2f2", color: "#dc2626" }}>
                🔴 즉시 거절 {counts.즉시거절}개
              </span>
            )}
            {counts.협상가능 > 0 && (
              <span style={{ ...s.countBadge, background: "#fefce8", color: "#ca8a04" }}>
                🟡 협상 가능 {counts.협상가능}개
              </span>
            )}
            {counts.법무검토필요 > 0 && (
              <span style={{ ...s.countBadge, background: "#f0fdf4", color: "#16a34a" }}>
                🟢 법무 검토 {counts.법무검토필요}개
              </span>
            )}
          </div>
        </div>

        {/* 조항 목록 */}
        <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #f1f5f9" }}>
            <span style={s.panelLabel}>조항 목록</span>
          </div>
          <div ref={listRef} style={{ maxHeight: 260, overflowY: "auto" }}>
            {clauses.map((clause, i) => {
              const v = getV(clause.verdict);
              const isSelected = i === selectedIndex;
              return (
                <div
                  key={i}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  onClick={() => onSelect(i)}
                  style={{
                    ...s.miniCard,
                    background: isSelected ? v.bg : "#fff",
                    borderLeft: isSelected ? `3px solid ${v.border}` : "3px solid transparent",
                  }}
                >
                  <span style={{ ...s.miniBadge, background: v.badgeBg, color: v.badgeColor }}>
                    {v.emoji} {v.label}
                  </span>
                  <p style={s.miniText}>
                    {clause.clause_text.slice(0, 45)}{clause.clause_text.length > 45 ? "..." : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* 선택 조항 상세 */}
        {selected && (() => {
          const v = getV(selected.verdict);
          const verifiedLaws = selected.cited_laws?.filter((l) => l.verified) ?? [];
          return (
            <div style={s.card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ ...s.detailBadge, background: v.badgeBg }}>
                  <span style={{ fontSize: 20 }}>{v.emoji}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: v.color }}>{v.label}</span>
                </div>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>조항 {selectedIndex + 1}</span>
              </div>

              <div style={s.detailSection}>
                <div style={s.detailLabel}>이유</div>
                <p style={s.detailBody}>{selected.summary}</p>
              </div>

              {verifiedLaws.length > 0 && (
                <div style={s.detailSection}>
                  <div style={s.detailLabel}>법령 근거</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {verifiedLaws.map((l, i) => (
                      <span key={i} style={s.lawTag}>
                        {l.law_name} {l.article_no}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 개발자 모드 */}
        <div style={{ marginTop: 8 }}>
          <button onClick={onToggleDev} style={s.devBtn}>
            {devOpen ? "▲ 원문 응답 닫기" : "▼ 백엔드 응답 원문 (개발자용)"}
          </button>
          {devOpen && (
            <pre style={s.devPre}>{JSON.stringify(clauses, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "'Pretendard', 'Apple SD Gothic Neo', sans-serif",
    color: "#1e293b",
    userSelect: "none",
  },

  // 헤더
  header: {
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "0 24px",
    height: 56,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: { fontSize: 18, fontWeight: 800, color: "#2563eb" },
  headerDesc: { fontSize: 13, color: "#94a3b8" },
  resetBtn: {
    fontSize: 13,
    color: "#2563eb",
    background: "none",
    border: "1px solid #2563eb",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontWeight: 500,
  },

  // 메인
  main: { maxWidth: 1200, margin: "0 auto", padding: "36px 24px" },

  // 입력 화면
  inputWrap: { display: "flex", justifyContent: "center", paddingTop: 32 },
  inputCard: {
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    padding: "40px 48px",
    width: "100%",
    maxWidth: 640,
  },
  inputTitle: { fontSize: 22, fontWeight: 700, marginBottom: 8 },
  inputSubtitle: { fontSize: 14, color: "#64748b", marginBottom: 28 },

  tabs: { display: "flex", gap: 6, marginBottom: 20 },
  tab: {
    padding: "8px 18px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 8,
    background: "#fff",
    fontSize: 14,
    cursor: "pointer",
    color: "#64748b",
    fontWeight: 500,
  },
  tabActive: { border: "1.5px solid #2563eb", color: "#2563eb", background: "#eff6ff", fontWeight: 600 },

  textarea: {
    width: "100%",
    padding: "14px 16px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    fontSize: 14,
    color: "#1e293b",
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
    lineHeight: 1.7,
    fontFamily: "inherit",
  },
  dropzone: {
    border: "2px dashed #cbd5e1",
    borderRadius: 10,
    padding: "48px 24px",
    textAlign: "center",
    cursor: "pointer",
    color: "#64748b",
    fontSize: 14,
  },

  submitBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    marginTop: 16,
    padding: "15px 0",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },
  submitBtnDisabled: { backgroundColor: "#93c5fd", cursor: "not-allowed" },
  spinner: {
    display: "inline-block",
    width: 16,
    height: 16,
    border: "2.5px solid rgba(255,255,255,0.4)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  },
  errorBox: {
    marginTop: 12,
    padding: "12px 16px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#dc2626",
    fontSize: 14,
  },

  // 결과 레이아웃
  resultLayout: { display: "flex", gap: 24, alignItems: "flex-start" },
  leftPanel: { flex: "0 0 60%", minWidth: 0 },
  rightPanel: { flex: "0 0 calc(40% - 24px)", minWidth: 0, position: "sticky", top: 72, display: "flex", flexDirection: "column", gap: 14 },

  panelLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    marginBottom: 12,
  },

  // 원문 텍스트 박스 (왼쪽)
  originalTextBox: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    padding: "20px 24px",
    fontSize: 14,
    color: "#1e293b",
    lineHeight: 1.85,
    wordBreak: "break-word" as const,
    userSelect: "text",
  },

  // 공통 카드
  card: {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    padding: "18px 20px",
  },
  countBadge: {
    padding: "5px 12px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
  },

  // 조항 미니 카드 (오른쪽 목록)
  miniCard: {
    padding: "10px 14px",
    cursor: "pointer",
    borderBottom: "1px solid #f1f5f9",
    transition: "background 0.1s",
  },
  miniBadge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 5,
  },
  miniText: { fontSize: 13, color: "#475569", margin: 0, lineHeight: 1.5 },

  // 상세 카드
  detailBadge: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 10,
  },
  detailSection: {
    borderTop: "1px solid #f1f5f9",
    paddingTop: 14,
    marginTop: 14,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    marginBottom: 6,
  },
  detailBody: { fontSize: 14, color: "#334155", lineHeight: 1.75, margin: 0, userSelect: "text" },
  lawTag: {
    display: "inline-block",
    padding: "4px 10px",
    background: "#eff6ff",
    color: "#2563eb",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    userSelect: "text",
  },

  // 개발자
  devBtn: { fontSize: 12, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 },
  devPre: {
    marginTop: 8,
    padding: 12,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: 11,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    color: "#475569",
    maxHeight: 300,
    overflowY: "auto" as const,
  },
};
