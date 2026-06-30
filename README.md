## ⚙️ Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd <repository-name>
```

### 2. Create a Virtual Environment

```bash
python -m venv .venv
```

Activate it:

**Windows**

```bash
.venv\Scripts\activate
```

**Linux/macOS**

```bash
source .venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
COLLECTION_NAME=pdf_chatbot
```

### 5. Start Qdrant

Ensure your local Qdrant server is running and accessible at:

```
http://localhost:6333
```

### 6. Run the Backend

```bash
uvicorn main:app --reload
```

### 7. Run the Frontend

```bash
npm install
npm run dev
```
