import asyncio
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
- 즉시거절: 아래 예시처럼 강행법규를 명백히 위반한 경우에만 사용.
  예) 최저임금 미달, 법정 초과근무 한도(주 12시간) 초과, 연차·퇴직금·수당 지급 의무 명시적 배제, 부당해고 조건 등.
  단순히 불리하거나 협상 여지가 있는 조항은 해당하지 않음.
- 협상가능: 법령 위반은 아니지만 근로자에게 불리하여 더 유리한 조건으로 협상할 수 있는 조항.
  예) 법정 기준은 충족하나 업계 평균보다 낮은 급여, 과도한 전직 제한, 일방적 업무 변경 조항 등.
- 법무검토필요: 중립적·표준적 조항이거나 해석이 필요한 경우. 아래 유형은 반드시 이 판정 사용.
  예) 계약기간 명시, 근무장소 명시, 직무 기술, 비밀유지 조항, 표준적인 복무규정 준수 의무 등.

규칙:
1. 중립적이거나 단순 사실을 명시하는 조항은 반드시 법무검토필요로 판정.
2. 즉시거절은 수당 미지급·법정 한도 초과 등 명백한 위법이 확인된 경우에만 사용.
3. 위법 여부가 불분명하면 즉시거절 대신 협상가능 또는 법무검토필요로 판정.

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


def _split_clauses(text: str) -> list[str]:
    """"제N조" 패턴으로 조항 분리. 조항 번호를 각 조항 텍스트에 보존."""
    parts = re.split(r"(제\d+조)", text)
    # parts = ['preamble', '제1조', ' 내용...', '제2조', ' 내용...', ...]
    clauses = []
    i = 1  # index 0은 조항 번호 이전 서문
    while i + 1 < len(parts):
        clause_text = (parts[i] + parts[i + 1]).strip()
        if clause_text:
            clauses.append(clause_text)
        i += 2
    return clauses


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
    """Claude 응답에서 JSON 객체만 추출하여 파싱. 코드블록 이후 추가 텍스트 무시."""
    m = re.search(r"\{[\s\S]*\}", content)
    if not m:
        raise ValueError("JSON을 찾을 수 없습니다.")
    return json.loads(m.group())


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
    """PDF 업로드 → 조항 분리 → 병렬 분석."""
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    pdf_bytes = await file.read()
    full_text = _extract_text_from_pdf(pdf_bytes).strip()
    if not full_text:
        raise HTTPException(status_code=422, detail="PDF에서 텍스트를 추출할 수 없습니다.")

    clauses = _split_clauses(full_text)
    if not clauses:
        raise HTTPException(status_code=422, detail="조항을 찾을 수 없습니다. '제N조' 형식의 조항이 있는지 확인하세요.")

    loop = asyncio.get_event_loop()
    results = await asyncio.gather(
        *[loop.run_in_executor(None, _analyze_clause, c) for c in clauses]
    )

    return {
        "clauses": [
            {"clause_text": clause, **result}
            for clause, result in zip(clauses, results)
        ]
    }


@app.post("/analyze/text")
async def analyze_text(body: TextRequest):
    """텍스트 직접 입력 → 파이프라인 실행."""
    clause = body.text.strip()
    if not clause:
        raise HTTPException(status_code=422, detail="텍스트가 비어 있습니다.")

    return _analyze_clause(clause)
