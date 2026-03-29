"""
하이브리드 검색 모듈 (FAISS dense + BM25 sparse)
결합 방식: Reciprocal Rank Fusion (RRF)

주의: FAISS 인덱스를 빌드할 때 사용한 임베딩 모델과 EMBED_MODEL이 일치해야 합니다.
      현재 설정값: BAAI/bge-m3 (dim=1024)
"""

import json
import pickle
from pathlib import Path
from typing import Optional

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

# ── 설정 ────────────────────────────────────────────────────────────────────
EMBED_MODEL = "BAAI/bge-m3"   # 인덱스 빌드 시 사용한 모델과 동일해야 함
TOP_K = 5
RRF_K = 60                    # RRF 상수 (일반적으로 60 사용)

DATA_DIR = Path(__file__).parent / "data"
FAISS_PATH = DATA_DIR / "faiss_index.bin"
BM25_PATH  = DATA_DIR / "bm25_index.pkl"
CHUNKS_PATH = DATA_DIR / "chunks.json"
# ────────────────────────────────────────────────────────────────────────────


def _load_resources():
    with open(CHUNKS_PATH, encoding="utf-8") as f:
        chunks = json.load(f)

    faiss_index = faiss.read_index(str(FAISS_PATH))

    with open(BM25_PATH, "rb") as f:
        bm25 = pickle.load(f)

    embedder = SentenceTransformer(EMBED_MODEL)

    return chunks, faiss_index, bm25, embedder


# 모듈 임포트 시 한 번만 로드 (지연 초기화)
_chunks = _faiss_index = _bm25 = _embedder = None


def _init():
    global _chunks, _faiss_index, _bm25, _embedder
    if _chunks is None:
        _chunks, _faiss_index, _bm25, _embedder = _load_resources()


def _rrf_score(rank: int) -> float:
    return 1.0 / (RRF_K + rank + 1)


def retrieve(
    query: str,
    top_k: int = TOP_K,
    law_name: Optional[str] = None,
    article_no: Optional[str] = None,
) -> list[dict]:
    """
    하이브리드 검색 후 상위 top_k개 반환.

    Args:
        query:      검색 쿼리 문자열
        top_k:      반환할 최대 결과 수 (기본 5)
        law_name:   필터링할 법률명 (예: "근로기준법"), None이면 전체
        article_no: 필터링할 조문 번호 (예: "제50조"), None이면 전체

    Returns:
        [{"law_name": ..., "article_no": ..., "text": ..., "score": ...}, ...]
    """
    _init()

    # ── 메타데이터 필터: 후보 인덱스 집합 구성 ───────────────────────────
    if law_name is not None or article_no is not None:
        candidate_indices = {
            i for i, c in enumerate(_chunks)
            if (law_name is None or c["law_name"] == law_name)
            and (article_no is None or c["article_no"] == article_no)
        }
        if not candidate_indices:
            return []
    else:
        candidate_indices = set(range(len(_chunks)))

    # ── Dense 검색 (FAISS) ───────────────────────────────────────────────
    query_vec = _embedder.encode([query], normalize_embeddings=True).astype("float32")
    n_search = min(len(_chunks), max(top_k * 10, 50))   # 충분히 넓게 후보 수집
    distances, indices = _faiss_index.search(query_vec, n_search)

    dense_ranks: dict[int, int] = {}
    rank = 0
    for idx in indices[0]:
        if idx == -1:
            continue
        if idx in candidate_indices:
            dense_ranks[idx] = rank
            rank += 1

    # ── Sparse 검색 (BM25) ───────────────────────────────────────────────
    tokenized_query = query.split()
    bm25_scores = _bm25.get_scores(tokenized_query)          # shape: (N,)

    sparse_ranked = sorted(
        ((i, s) for i, s in enumerate(bm25_scores) if i in candidate_indices),
        key=lambda x: x[1],
        reverse=True,
    )
    sparse_ranks: dict[int, int] = {idx: rank for rank, (idx, _) in enumerate(sparse_ranked)}

    # ── RRF 결합 ─────────────────────────────────────────────────────────
    all_indices = set(dense_ranks) | set(sparse_ranks)
    rrf_scores: dict[int, float] = {}
    for idx in all_indices:
        dense_rrf  = _rrf_score(dense_ranks[idx])  if idx in dense_ranks  else 0.0
        sparse_rrf = _rrf_score(sparse_ranks[idx]) if idx in sparse_ranks else 0.0
        rrf_scores[idx] = dense_rrf + sparse_rrf

    top_indices = sorted(rrf_scores, key=lambda i: rrf_scores[i], reverse=True)[:top_k]

    # ── 결과 구성 ─────────────────────────────────────────────────────────
    results = []
    for idx in top_indices:
        chunk = _chunks[idx]
        results.append({
            "law_name":  chunk["law_name"],
            "article_no": chunk["article_no"],
            "text":      chunk["text"],
            "score":     round(rrf_scores[idx], 6),
        })

    return results
