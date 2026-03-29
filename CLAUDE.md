# 사인전에 — AI 기반 근로계약서 독소조항 탐지 서비스

## 프로젝트 개요
근로계약서 PDF 업로드 또는 텍스트 직접 입력 → 독소조항 탐지 → 3단계 판정 + 법령 근거 제시

## 기술 스택
- Backend: FastAPI (backend/main.py) — Railway 배포 예정
- Frontend: Next.js (frontend/) — Vercel 배포 예정
- Embedding: BAAI/bge-m3
- Vector DB: FAISS (backend/data/faiss_index.bin)
- Sparse Search: BM25 (backend/data/bm25_index.pkl)
- LLM: Claude API (claude-haiku-4-5-20251001 또는 claude-sonnet-4-6)
- PDF 파싱: PyMuPDF

## 파이프라인
1. 텍스트 입력 또는 PDF → PyMuPDF 텍스트 추출
2. retriever.retrieve(query) → FAISS + BM25 하이브리드 검색
3. Claude API CoT 추론 → 3단계 판정 (즉시거절/협상가능/법무검토필요)
4. Hallucination Cross-check → 조항 번호 Regex 추출 → 인덱스 1:1 매칭

## 출력 형식
- 판정: 🔴 즉시 거절 / 🟡 협상 가능 / 🟢 법무 검토 필요
- 근거: 법령명 + 조항 번호
- 이유: 2~4문장 설명

## 현재 완료된 것
- backend/retriever.py 완성 (하이브리드 검색 + 메타데이터 필터링)
- backend/data/ 인덱스 파일 3개 (faiss_index.bin, bm25_index.pkl, chunks.json)
- backend/main.py stub 상태 (POST /analyze 엔드포인트 미완성)

## 다음 할 것
- backend/main.py /analyze 엔드포인트에 실제 파이프라인 연결
- Hallucination Cross-check 코드 작성
- 프론트엔드 연결
