import asyncio
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

client = anthropic.Anthropic()

VERDICT_MAP = {
    "즉시거절": {"label": "즉시 거절", "emoji": "🔴"},
    "협상가능": {"label": "협상 가능", "emoji": "🟡"},
    "법무검토필요": {"label": "법무 검토 필요", "emoji": "🟢"},
    "문제없음": {"label": "문제 없음", "emoji": "⚪"},
}

SYSTEM_PROMPT = """당신은 대한민국 노동법 전문가입니다.
근로계약서 조항을 분석하여 4단계 중 하나로 판정하고, 반드시 JSON으로만 응답하세요.

━━━ HARD CONSTRAINTS (강행규정 절대 기준) ━━━
아래 수치를 위반하는 조항은 무조건 즉시거절입니다. 예외 없음.

[임금]
- 최저임금 미달 (최저임금법 제6조) → 즉시거절
- 수습 기간 임금 감액 한도: 최저임금의 90% 미만 (최저임금법 제5조 제2항)
  → 수습 임금을 최저임금의 90% 미만(예: 50%, 70% 등)으로 정한 조항은 즉시거절
  → 감액 적용 조건: 1년 이상 기간제 계약 + 수습 사용일로부터 3개월 이내에만 허용
- 임금 전액·직접·통화 지급 원칙 위반 (근로기준법 제43조) → 즉시거절
- 전차금·부채와 임금 상계 (근로기준법 제21조) → 즉시거절

[근로시간]
- 법정근로시간 초과: 주 40시간 초과 (근로기준법 제50조) → 별도 합의 없으면 즉시거절
- 연장근로 한도 초과: 주 12시간 초과 (근로기준법 제53조) → 즉시거절
- 연장·야간·휴일 가산수당 미지급 또는 배제 (근로기준법 제56조)
  → 연장·야간: 통상임금의 50% 이상 가산 의무
  → 휴일근로: 8시간 이내 50%, 8시간 초과 100% 가산 의무

[휴가·휴일]
- 주휴일 미부여 또는 무급화 (근로기준법 제55조) → 즉시거절
- 연차유급휴가 배제 또는 미지급 (근로기준법 제60조) → 즉시거절
  → 1년 80% 이상 출근 시 15일, 1년 미만 시 매월 1일 발생

[퇴직·해고]
- 퇴직금 지급 의무 배제 (근로자퇴직급여 보장법 제8조) → 즉시거절
  → 계속근로 1년에 30일분 이상 평균임금 의무
- 해고 예고 없이 즉시 해고 가능 조항 (근로기준법 제26조) → 즉시거절
  → 30일 전 예고 또는 30일분 이상 통상임금 지급 의무
- 정당한 이유 없는 해고 허용 조항 (근로기준법 제23조) → 즉시거절

[위약금·손해배상]
- 근로 불이행에 대한 위약금·손해배상액 예정 조항 (근로기준법 제20조) → 즉시거절
  → 교육비 상환 약정도 과도하거나 재직 의무 기간이 지나치게 긴 경우 해당
- 강제 저축 또는 저축금 관리 강요 (근로기준법 제22조) → 즉시거절

━━━ 판정 카테고리 경계 ━━━

즉시거절 (🔴): HARD CONSTRAINTS 위반 = 법적으로 불법. 계약서에 적혀 있어도 해당 조항은 무효.
협상가능 (🟡): 불법은 아니나 근로자에게 일방적으로 불리. 더 유리한 조건으로 협상 여지가 있음.
  예) 업계 평균보다 낮은 급여, 과도한 경업금지·전직 제한, 일방적 업무 변경, 과도한 손해배상 범위 등
법무검토필요 (🟢): 중립적·표준적 조항이거나 맥락에 따라 해석이 달라지는 경우.
  예) 계약기간·근무장소·직무 명시, 비밀유지 의무, 표준 복무규정 준수, 수습 기간 명시(감액 조건 없는 경우)
문제없음 (⚪): 근로자에게 불리하지 않고 법령을 준수하는 표준적인 조항. 문제 삼을 여지가 전혀 없음.
  예) 법정 기준을 충족하거나 초과하는 급여·휴가 조항, 근로자에게 유리한 조항, 단순 행정적 명시 조항

━━━ CoT 추론 순서 (reasoning 필수 구조) ━━━
1. 조항에서 수치·조건·키워드 추출 (예: "수습 임금 50%", "주 60시간")
2. 해당하는 HARD CONSTRAINTS 또는 관련 법령 기준 제시 (구체적 수치 명시)
3. 조항 수치 vs 법적 기준 직접 비교 (예: "50% < 90% → 위반")
4. RAG로 검색된 법령 자료를 우선 참조. 검색 자료와 내부 지식이 충돌하면 검색 자료 우선.
5. 판정 결정 및 그 이유 한 문장으로 확정

━━━ RAG 우선순위 ━━━
- 아래 "관련 법령 참고 자료"에 검색된 조문이 있으면 그것을 최우선 근거로 사용.
- 검색 자료에 없는 법령을 cited_laws에 포함할 때는 내부 지식 기반임을 인식하고 신중하게 판단.
- 검색 자료가 내부 지식과 다른 경우 검색 자료를 따름.

━━━ 말투 규칙 (summary) ━━━
- "~입니다", "~습니다" 종결어미 사용. "~할 수 있습니다", "~인 것 같습니다" 금지.
- 조항의 구체적 수치·조건을 직접 인용 후 법적 기준과 숫자로 비교.
- 위반이면 어떤 법 조문을 위반했는지, 실제 어떤 피해가 생기는지 명시.
- 협상가능이면 구체적인 협상 방향(기간 단축, 범위 명확화 등) 제시.

━━━ 응답 JSON 스키마 (이 형식만 허용) ━━━
{
  "verdict": "즉시거절" | "협상가능" | "법무검토필요" | "문제없음",
  "reasoning": "CoT 추론 순서에 따라 단계적으로 서술 (4~6문장). 반드시 수치 비교 포함.",
  "summary": "최종 이유 요약 (3~5문장). 말투 규칙 준수. 수치 인용 + 법령 기준 비교 + 피해/위험 + 대응 방향 포함.",
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


def _split_clauses_with_claude(text: str) -> list[str]:
    """제N조 패턴 없는 텍스트를 Claude API로 의미 단위 조항 분리."""
    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": (
                "다음 텍스트를 근로계약 조항 단위로 분리해줘.\n"
                "각 조항은 하나의 독립적인 근로조건을 담아야 해.\n"
                "텍스트가 짧거나 단일 조항으로 볼 수 있으면 억지로 쪼개지 말고 전체를 하나의 항목으로 반환해.\n"
                "JSON 배열로만 응답해: [\"조항1\", \"조항2\", ...]\n\n"
                f"{text}"
            ),
        }],
    )
    m = re.search(r"\[[\s\S]*\]", message.content[0].text)
    if not m:
        return [text]
    try:
        clauses = json.loads(m.group())
        return clauses if isinstance(clauses, list) and len(clauses) > 0 else [text]
    except json.JSONDecodeError:
        return [text]


def _analyze_clause(clause: str) -> dict:
    # 1. 하이브리드 검색
    law_chunks = retrieve(clause, top_k=TOP_K)

    # 2. Claude API CoT 추론
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
    except (json.JSONDecodeError, IndexError, ValueError) as e:
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
    loop = asyncio.get_running_loop()

    if not clauses:
        clauses = await loop.run_in_executor(None, _split_clauses_with_claude, full_text)

    if len(clauses) == 1:
        result = await loop.run_in_executor(None, _analyze_clause, clauses[0])
        return {"original_text": full_text, **result}

    results = await asyncio.gather(
        *[loop.run_in_executor(None, _analyze_clause, c) for c in clauses]
    )

    return {
        "original_text": full_text,
        "clauses": [
            {"clause_text": clause, **result}
            for clause, result in zip(clauses, results)
        ]
    }


@app.post("/analyze/text")
async def analyze_text(body: TextRequest):
    """텍스트 직접 입력 → 조항 분리 시도 → 병렬 분석 or 단일 분석 fallback."""
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="텍스트가 비어 있습니다.")

    clauses = _split_clauses(text)

    if clauses:
        loop = asyncio.get_running_loop()
        results = await asyncio.gather(
            *[loop.run_in_executor(None, _analyze_clause, c) for c in clauses]
        )
        return {
            "original_text": text,
            "clauses": [
                {"clause_text": clause, **result}
                for clause, result in zip(clauses, results)
            ]
        }

    # 제N조 패턴 없으면 Claude로 의미 단위 분리
    loop = asyncio.get_running_loop()
    clauses = await loop.run_in_executor(None, _split_clauses_with_claude, text)

    if len(clauses) == 1:
        result = await loop.run_in_executor(None, _analyze_clause, clauses[0])
        return {"original_text": text, **result}

    results = await asyncio.gather(
        *[loop.run_in_executor(None, _analyze_clause, c) for c in clauses]
    )
    return {
        "original_text": text,
        "clauses": [
            {"clause_text": clause, **result}
            for clause, result in zip(clauses, results)
        ]
    }
