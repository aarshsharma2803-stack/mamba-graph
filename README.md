# 🧠 Mamba-Graph

**AI-Powered 3D Repository Cartographer** — Visualize any codebase as an interactive 3D force graph powered by NVIDIA Nemotron-Nano-9B-v2.

![Mamba-Graph](https://img.shields.io/badge/NVIDIA-Nemotron_9B-76b900?style=for-the-badge&logo=nvidia)

---

## ✨ Features

### 🗺️ 3D Architecture Mapping
Paste any GitHub URL or local path — Nemotron analyzes the codebase and generates an interactive 3D force-directed graph showing files as nodes and dependencies as animated links.

- **Node types**: Stars (entry points), Planets (core logic), Moons (utilities), Satellites (config/docs)
- **Color modes**: By type, complexity heatmap, or language
- **Animated reveal**: Nodes appear one-by-one as the graph builds
- **Click-to-inspect**: Fly to any node and see purpose, classes, functions, dependencies

### 🛡️ Security Audit
Nemotron scans your codebase for vulnerabilities — hardcoded secrets, SQL injection, path traversal, missing auth, CORS misconfig, XSS, and more. Returns a security score with severity-ranked findings and specific fix recommendations.

### 📖 Onboarding Guide
Generates a step-by-step walkthrough of any codebase as if a senior developer is explaining it to a new hire. Includes tech stack, data flow, architecture diagram, "your first task", and gotchas.

### ⚡ GPU/CUDA Analysis
Built for NVIDIA GTC — analyzes GPU/CUDA usage patterns, identifies memory transfer bottlenecks, suggests optimizations like mixed precision training, and estimates speedup. Works with PyTorch, TensorFlow, and raw CUDA.

### 💬 Interactive Query
Ask Nemotron anything about the codebase after scanning: "What's the most coupled module?", "Where should I add a new API route?", "Explain the data flow."

---

## 🏗️ Architecture

```
┌─────────────────┐     SSE Stream      ┌──────────────────┐
│   React + 3D    │ ◄─────────────────► │  FastAPI Backend  │
│  Force Graph    │                      │                   │
│  (Three.js)     │     HTTP/JSON        │  File Scanner     │
│                 │ ◄─────────────────► │  Import Resolver  │
└─────────────────┘                      │  Complexity Scorer│
                                         │        │          │
                                         │        ▼          │
                                         │  ┌────────────┐   │
                                         │  │  Nemotron   │   │
                                         │  │  9B v2 API  │   │
                                         │  └────────────┘   │
                                         └──────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- Git
- [NVIDIA API Key](https://build.nvidia.com/) (free)

### 1. Clone
```bash
git clone https://github.com/aarshsharma2803-stack/mamba-graph.git
cd mamba-graph
```

### 2. Backend Setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
```

### 4. Configure API Key
Either set it in the UI (it saves to `.env` automatically), or manually:
```bash
cd ../backend
echo "NVIDIA_API_KEY=nvapi-your-key-here" > .env
```

### 5. Run
Terminal 1 — Backend:
```bash
cd backend
source venv/bin/activate
python main.py
```

Terminal 2 — Frontend:
```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** → paste a GitHub URL → click **Map Repo**.

---

## 📸 Usage

1. **Enter a GitHub URL** (e.g. `https://github.com/tiangolo/fastapi`) or local path
2. **Click Map Repo** — watch Nemotron's reasoning stream in real-time
3. **Explore the 3D graph** — orbit, zoom, click nodes
4. **Switch color modes** — type / complexity heatmap / language
5. **Run Security Scan** — click Security tab → Run Scan
6. **Generate Onboarding Guide** — click Guide tab → Generate
7. **Analyze GPU Performance** — click GPU tab → Analyze
8. **Ask questions** — click Query tab → type anything about the code

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| AI Engine | NVIDIA Nemotron-Nano-9B-v2 (Mamba-2/Transformer Hybrid) |
| Backend | Python, FastAPI, SSE Streaming |
| Frontend | React, Three.js, react-force-graph-3d, Framer Motion |
| Styling | Tailwind CSS |
| Analysis | Static import resolution, complexity scoring, 30+ languages |

---

## 📁 Project Structure

```
mamba-graph/
├── backend/
│   ├── main.py              # FastAPI server + Nemotron orchestrator
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # API key (created on first save, gitignored)
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main React app (3D graph + all panels)
│   │   └── index.css        # Production dark theme
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── .gitignore
└── README.md
```

---

## 🔑 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/analyze` | Map a repository (SSE stream) |
| POST | `/api/v1/query` | Ask about the codebase (SSE stream) |
| POST | `/api/v1/security` | Security vulnerability scan (SSE stream) |
| POST | `/api/v1/onboarding` | Generate onboarding guide (SSE stream) |
| POST | `/api/v1/cuda` | GPU/CUDA performance analysis (SSE stream) |
| POST | `/api/v1/save-key` | Save NVIDIA API key |
| GET | `/api/v1/check-key` | Check if API key exists |
| DELETE | `/api/v1/cache` | Clear cloned repo cache |

---

## 🌐 Supported Languages

Python, JavaScript, TypeScript, React (JSX/TSX), C, C++, CUDA, Rust, Go, Java, Kotlin, Swift, Ruby, PHP, C#, Scala, Dart, Vue, Svelte, Shell, SQL, Lua, Zig, Elixir, R, GraphQL, Prisma, Protobuf + configs (JSON, YAML, TOML, XML, Dockerfile, Makefile, etc.)

---

## 📜 License

MIT

---

**Built with 🧠 NVIDIA Nemotron for GTC 2026**