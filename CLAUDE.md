# 사인전에 — AI 기반 근로계약서 독소조항 탐지 서비스

## 프로젝트 개요

근로계약서 PDF 업로드 또는 텍스트 직접 입력 → 조항 단위 분리 → 독소조항 탐지 → 4단계 판정 + 법령 근거 제시

## 기술 스택

- Backend: FastAPI (backend/main.py) — Railway 배포
- Frontend: Next.js 15 / TypeScript (frontend/) — Vercel 배포 예정
- Embedding: BAAI/bge-m3 (dim=1024)
- Vector DB: FAISS (backend/data/faiss_index.bin)
- Sparse Search: BM25 (backend/data/bm25_index.pkl)
- 결합: Reciprocal Rank Fusion (RRF, k=60)
- LLM: Claude API (claude-haiku-4-5-20251001)
- PDF 파싱: PyMuPDF
- 법령 데이터: 근로기준법·최저임금법·남녀고용평등법 252개 조문 (backend/data/chunks.json)

## 파이프라인

1. 텍스트 입력 또는 PDF → PyMuPDF 텍스트 추출
2. 조항 분리: `제N조` 정규식 1차 분리 → 패턴 없으면 Claude API로 의미 단위 분리 (fallback)
3. retriever.retrieve(query, top_k=5) → FAISS + BM25 하이브리드 검색 (RRF 융합, 메타데이터 필터 지원)
4. Claude API CoT 추론 → 4단계 판정 (즉시거절/협상가능/법무검토필요/문제없음)
5. Hallucination Cross-check → 인용 조항 번호 Regex 추출 → 검색 인덱스와 1:1 매칭 → verified 플래그
6. 조항 다수일 경우 asyncio.gather + run_in_executor로 병렬 분석

## API 엔드포인트

- `POST /analyze` — PDF 파일 업로드 (multipart/form-data)
- `POST /analyze/text` — 텍스트 직접 입력 (JSON: {"text": "..."})

## 출력 형식

- 판정: 🔴 즉시 거절 / 🟡 협상 가능 / 🔵 법무 검토 필요 / 🟢 문제 없음
- reasoning: CoT 추론 과정 (4~6문장, 수치 비교 포함)
- summary: 최종 이유 요약 (3~5문장)
- cited_laws: [{law_name, article_no, verified}] — verified=false면 인덱스에 없는 조문(환각 의심)
- retrieved_chunks: 검색된 근거 법령 (디버그용, score 포함)

## 현재 완료된 것

- backend/retriever.py — 하이브리드 검색(RRF) + 메타데이터 필터링 완성
- backend/main.py — /analyze, /analyze/text 엔드포인트 완성, 파이프라인 전체 연결
- Hallucination Cross-check 로직 완성
- 시스템 프롬프트 — HARD CONSTRAINTS(강행규정 정량 기준) + CoT 추론 순서 강제
- backend/data/ — 인덱스 3종 (faiss_index.bin, bm25_index.pkl, chunks.json)
- frontend/ — 텍스트/PDF 입력 UI + 조항별 판정 결과·근거 법령 시각화 완성
- Railway 배포 설정 (Procfile)

## 다음 할 것

- 프론트엔드 Vercel 배포 + 백엔드 CORS 프로덕션 origin 설정
- 판정 이모지/색 3곳 통일
- 법적 디스클레이머 UI 추가
