"use client";

import { useState, useRef } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setResult(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("http://localhost:8000/analyze", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail ?? "분석 중 오류가 발생했습니다.");
      }

      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>SafeSign</h1>
      <p style={styles.subtitle}>PDF 계약서를 업로드하면 분석 결과를 제공합니다.</p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div
          style={styles.dropzone}
          onClick={() => inputRef.current?.click()}
        >
          {file ? (
            <span>{file.name}</span>
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

        <button type="submit" disabled={!file || loading} style={styles.button}>
          {loading ? "분석 중..." : "분석 시작"}
        </button>
      </form>

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.result}>
          <h2 style={{ marginBottom: 8 }}>분석 결과</h2>
          <pre style={styles.pre}>{result}</pre>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 600,
    margin: "80px auto",
    padding: "0 24px",
    fontFamily: "sans-serif",
  },
  title: {
    fontSize: 32,
    fontWeight: 700,
    marginBottom: 8,
  },
  subtitle: {
    color: "#555",
    marginBottom: 32,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  dropzone: {
    border: "2px dashed #ccc",
    borderRadius: 8,
    padding: "40px 24px",
    textAlign: "center",
    cursor: "pointer",
    color: "#555",
    transition: "border-color 0.2s",
  },
  button: {
    padding: "12px 24px",
    backgroundColor: "#0070f3",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 16,
    cursor: "pointer",
  },
  error: {
    marginTop: 24,
    padding: 16,
    backgroundColor: "#fff0f0",
    border: "1px solid #f88",
    borderRadius: 8,
    color: "#c00",
  },
  result: {
    marginTop: 24,
    padding: 16,
    backgroundColor: "#f6f8fa",
    border: "1px solid #e1e4e8",
    borderRadius: 8,
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    fontSize: 14,
  },
};
