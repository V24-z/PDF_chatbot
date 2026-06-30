import os
import re
import hashlib
import json
import fitz  # PyMuPDF
import torch # Torch check for hardware acceleration
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from supabase import create_client, Client

load_dotenv()

app = FastAPI(title="SaaS Multi-User Supabase Cloud Chatbot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#  SUPABASE CLOUD CLIENT INITIALIZATION
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# QDRANT CLOUD CONNECTION CORE
raw_url = os.getenv("QDRANT_URL", "http://127.0.0.1:6333").strip()
raw_key = os.getenv("QDRANT_API_KEY", None)
clean_url = raw_url.replace('"', '').replace("'", "").strip().rstrip("/")
if "cloud.qdrant.io" in clean_url and clean_url.endswith(":6333"):
    clean_url = clean_url.replace(":6333", "")
clean_key = raw_key.replace('"', '').replace("'", "").strip() if raw_key else None

try:
    qdrant_client = QdrantClient(url=clean_url, api_key=clean_key, timeout=120, check_compatibility=False)
except Exception:
    qdrant_client = None
#=====Embeddings========
device_target = "cuda" if torch.cuda.is_available() else "cpu"
embed_model = HuggingFaceBgeEmbeddings(
    model_name="BAAI/bge-small-en-v1.5", 
    model_kwargs={"device": device_target}, 
    encode_kwargs={"normalize_embeddings": True, "batch_size": 256}, 
    cache_folder="./storage/cache"
)

# --- SECURITY SCHEMAS ---
class AuthRequest(BaseModel):
    username: str  
    password: str

class ChatSaveRequest(BaseModel):
    user_id: str   
    id: str
    title: str
    collection_id: str
    response_type: str
    messages: List[Dict]

# --- ROUTING LOGIC: SUPABASE AUTHENTICATION ENGINE ---
@app.post("/api/auth/register")
async def register_user(req: AuthRequest):
    email = req.username if "@" in req.username else f"{req.username}@botanical.ai"
    try:
        res = supabase_client.auth.sign_up({
            "email": email, 
            "password": req.password,
            "options": {"data": {"display_username": req.username}}
        })
        if not res.user:
            raise HTTPException(status_code=400, detail="Registration failed.")
        return {"status": "success", "user_id": res.user.id, "username": req.username}
    except Exception as e:
        error_msg = str(e)
        if "rate limit" in error_msg.lower():
            raise HTTPException(status_code=429, detail="Supabase registration rate limit reached. Please wait a while and try again!")
        raise HTTPException(status_code=400, detail=error_msg)

@app.post("/api/auth/login")
async def login_user(req: AuthRequest):
    email = req.username if "@" in req.username else f"{req.username}@botanical.ai"
    try:
        res = supabase_client.auth.sign_in_with_password({"email": email, "password": req.password})
        if not res.user:
            raise HTTPException(status_code=401, detail="Authentication failed.")
        
        user_meta = res.user.user_metadata
        actual_username = user_meta.get("display_username", req.username)
        return {"status": "success", "user_id": res.user.id, "username": actual_username}
    except Exception as e:
        raise HTTPException(status_code=401, detail=f" login credentials was wrong! ({str(e)})")

# --- ROUTING LOGIC: PERSISTENT CHAT HISTORY SYSTEM ---
@app.get("/api/chats/{user_id}")
async def get_user_chats(user_id: str):
    try:
        res = supabase_client.table("chats").select("*").eq("user_id", user_id).execute()
        result = []
        for row in res.data:
            result.append({
                "id": row["id"],
                "title": row["title"],
                "collectionId": row["collection_id"],
                "responseType": row["response_type"],
                "messages": json.loads(row["messages"]) if isinstance(row["messages"], str) else row["messages"]
            })
        return result
    except Exception as e:
        print(f"Error fetching chats: {str(e)}")
        return []

@app.post("/api/chats/save")
async def save_chat_session(req: ChatSaveRequest):
    try:
        chat_data = {
            "id": req.id,
            "user_id": req.user_id,
            "title": req.title,
            "collection_id": req.collection_id,
            "response_type": req.response_type,
            "messages": json.dumps(req.messages)
        }
        supabase_client.table("chats").upsert(chat_data).execute()
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/chats/{chat_id}")
async def delete_chat_session(chat_id: str):
    try:
        supabase_client.table("chats").delete().eq("id", chat_id).execute()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- INGESTION CORE PIECE ---
@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not qdrant_client:
        raise HTTPException(status_code=500, detail="Qdrant not ready.")
    try:
        file_bytes = await file.read()
        file_hash = hashlib.md5(file_bytes).hexdigest()
        collection_name = f"pdf_{file_hash}"
        
        try:
            if qdrant_client.get_collection(collection_name=collection_name):
                return {"message": "Exists", "collection_id": collection_name}
        except Exception:
            pass
            
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        text_buffer = [page.get_text() for page in doc if page.get_text().strip()]
        doc.close()
        
        full_text = "\n\n".join(text_buffer)
        if not full_text.strip():
            full_text = "Fallback character metadata layer."

        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200, separators=["\n\n", "\n", " ", ""])
        all_chunks = splitter.split_text(full_text)

        qdrant_client.recreate_collection(
            collection_name=collection_name,
            vectors_config=qmodels.VectorParams(size=384, distance=qmodels.Distance.COSINE),
        )
        
        batch_size = 256 
        points = []
        for i in range(0, len(all_chunks), batch_size):
            batch_chunks = all_chunks[i:i + batch_size]
            batch_vectors = embed_model.embed_documents(batch_chunks)
            for j, chunk in enumerate(batch_chunks):
                points.append(qmodels.PointStruct(id=i+j, vector=batch_vectors[j], payload={"text": chunk}))
                
        qdrant_client.upsert(collection_name=collection_name, points=points)
        return {"message": "Success", "collection_id": collection_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChatRequest(BaseModel):
    collection_id: str
    question: str
    response_type: str = "normal"
    history: List[Dict[str, str]] = []

@app.post("/api/chat")
async def chat_with_pdf(req: ChatRequest):
    try:
        api_key = os.getenv("GROQ_API_KEY")
        search_query = req.question
        if req.history:
            for msg in reversed(req.history):
                if msg.get("sender") == "user":
                    search_query = msg["text"]
                    break

        query_vector = embed_model.embed_query(search_query)
        response_data = qdrant_client.query_points(collection_name=req.collection_id, query=query_vector, limit=4)
        context = "\n---\n".join([res.payload["text"] for res in response_data.points if res.payload and "text" in res.payload])
        
        system_instruction = (
            "Answer precisely based strictly on context on separate lines if listing items."
            if req.response_type.lower() == "short" else
            "Provide an absolute detailed structural response based on context. Format lists or questions strictly on a fresh new line."
        )

        llm = ChatGroq(temperature=0.2, groq_api_key=api_key, model_name="llama-3.3-70b-versatile")
        prompt = ChatPromptTemplate.from_template(f"{system_instruction}\n\nContext:\n{{context}}\n\nQuestion: {{question}}\n\nAnswer:")
        response = (prompt | llm).invoke({"context": context, "question": req.question})
        return {"response": response.content.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))