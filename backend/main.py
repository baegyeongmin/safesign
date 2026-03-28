from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="PDF 파일만 업로드 가능합니다.")

    contents = await file.read()

    return {
        "filename": file.filename,
        "size": len(contents),
        "result": "분석 결과가 여기에 표시됩니다.",
    }
