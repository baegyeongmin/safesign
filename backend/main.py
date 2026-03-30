import os
import re
import json

from dotenv import load_dotenv
load_dotenv()

import anthropic
import fitz  # PyMuPDF
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from retriever import retrieve

# ── 설정 ────────────────────────────────────────────────────────────────────
CLAUDE_MODEL = "claude-haiku-4-5-20251001"
TOP_K = 5

VERDICT_MAP = {
    "즉시거절": {"label": "즉시 거절", "emoji": "🔴"},
    "협상가능": {"label": "협상 가능", "emoji": "🟡"},
    "법무검토필요": {"label": "법무 검토 필요", "emoji": "🟢"},
}

SYSTEM_PROMPT = """당신은 한국 노동법 전문가입니다.
근로계약서의 특정 조항을 분석하여 다음 3단계 중 하나로 판정하고, 반드시 JSON으로만 응답하세요.

판정 기준:
- 즉시거절: 법령 위반이 명백하거나 근로자에게 심각하게 불리한 조항
- 협상가능: 법령 위반은 아니지만 근로자에게 불리하여 협상이 필요한 조항
- 법무검토필요: 해석이 모호하거나 전문가 검토가 필요한 조항

응답 JSON 스키마 (이 형식만 허용):
{
  "verdict": "즉시거절" | "협상가능" | "법무검토필요",
  "reasoning": "판정 근거를 단계적으로 서술한 CoT (3~5문장)",
  "summary": "최종 이유 요약 (2~4문장, 일반인이 이해할 수 있도록)",
  "cited_laws": [{"law_name": "법령명", "article_no": "조문번호"}, ...]
}"""
# ────────────────────────────────────────────────────────────────────────────

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TextRequest(BaseModel):
    text: str


# ── 내부 함수 ────────────────────────────────────────────────────────────────

def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    return "\n".join(page.get_text() for page in doc)


def _build_user_prompt(clause: str, law_chunks: list[dict]) -> str:
    context_blocks = "\n\n".join(
        f"[{c['law_name']} {c['article_no']}]\n{c['text']}"
        for c in law_chunks
    )
    return f"""## 분석할 근로계약서 조항
{clause}

## 관련 법령 참고 자료
{context_blocks}

위 조항을 관련 법령에 비추어 분석하고, 지정된 JSON 형식으로만 응답하세요."""


def _parse_claude_response(content: str) -> dict:
    """Claude 응답에서 JSON을 추출하고 파싱."""
    # 마크다운 코드블록 제거
    cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", content).strip()
    return json.loads(cleaned)


def _cross_check_citations(cited_laws: list[dict], chunks: list[dict]) -> list[dict]:
    """
    Hallucination Cross-check:
    Claude가 인용한 조항 번호를 인덱스에서 1:1 매칭하여 검증.
    인덱스에 없는 조항은 unverified 플래그 추가.
    """
    def _extract_article(article_no: str) -> str:
        m = re.match(r"(제\d+조)", article_no or "")
        return m.group(1) if m else article_no

    index_keys = {(c["law_name"], _extract_article(c["article_no"])) for c in chunks}
    verified = []
    for citation in cited_laws:
        article = _extract_article(citation.get("article_no", ""))
        key = (citation.get("law_name", ""), article)
        verified.append({**citation, "verified": key in index_keys})
    return verified


def _analyze_clause(clause: str) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.")

    # 1. 하이브리드 검색
    law_chunks = retrieve(clause, top_k=TOP_K)

    # 2. Claude API CoT 추론
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_prompt(clause, law_chunks)}],
    )
    raw_content = message.content[0].text

    # 3. JSON 파싱
    try:
        parsed = _parse_claude_response(raw_content)
    except (json.JSONDecodeError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Claude 응답 파싱 실패: {e}\n원문: {raw_content}")

    # 4. Hallucination Cross-check
    cited = parsed.get("cited_laws", [])
    parsed["cited_laws"] = _cross_check_citations(cited, law_chunks)

    # 5. 출력 형식 조합
    verdict_key = parsed.get("verdict", "")
    verdict_info = VERDICT_MAP.get(verdict_key, {"label": verdict_key, "emoji": "⚪"})

    return {
        "verdict": verdict_info["emoji"] + " " + verdict_info["label"],
        "verdict_code": verdict_key,
        "reasoning": parsed.get("reasoning", ""),
        "summary": parsed.get("summary", ""),
        "cited_laws": parsed.get("cited_laws", []),
        "retrieved_chunks": [
            {"law_name": c["law_name"], "article_no": c["article_no"], "score": c["score"]}
            for c in law_chunks
        ],
    }


# ── 엔드포인트 ───────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """PDF 업로드 → 텍스트 추출 → 파이프라인 실행."""
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    pdf_bytes = await file.read()
    clause = _extract_text_from_pdf(pdf_bytes).strip()
    if not clause:
        raise HTTPException(status_code=422, detail="PDF에서 텍스트를 추출할 수 없습니다.")

    return _analyze_clause(clause)


@app.post("/analyze/text")
async def analyze_text(body: TextRequest):
    """텍스트 직접 입력 → 파이프라인 실행."""
    clause = body.text.strip()
    if not clause:
        raise HTTPException(status_code=422, detail="텍스트가 비어 있습니다.")

    return _analyze_clause(clause)
