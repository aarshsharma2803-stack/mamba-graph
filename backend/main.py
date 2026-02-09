"""
Mamba-Graph: Enterprise Repository Cartographer (GTC 2026 Edition)
Engine: NVIDIA Nemotron-Nano-9B-v2 (Mamba-2/Transformer Hybrid)

Features:
  - Deep Metadata Extraction with Complexity Scoring
  - GitHub/GitLab/Bitbucket URL Cloning
  - Persistent API Key (save once, use always)
  - Dual-Channel SSE Streaming (Reasoning + Content)
  - Interactive Query Mode
  - Hotspot Detection + Dependency Table
  - Export: JSON, Mermaid
"""

import os
import re
import json
import math
import shutil
import logging
import asyncio
import hashlib
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from collections import defaultdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from openai import OpenAI
from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────────────────────────
# SETUP
# ─────────────────────────────────────────────────────────────────────────────
load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("MambaGraph")

ENV_FILE = Path(__file__).parent / ".env"
CLONE_DIR = Path(tempfile.gettempdir()) / "mamba-graph-clones"
CLONE_DIR.mkdir(exist_ok=True)

NVIDIA_MODEL = "nvidia/nvidia-nemotron-nano-9b-v2"
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

IGNORE_PATHS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv", "env",
    "dist", "build", ".next", "target", "vendor", "coverage",
    ".vscode", ".idea", "bin", "obj", "logs", "tmp", ".cache",
    ".tox", ".mypy_cache", ".pytest_cache", "egg-info",
}

LANGUAGE_MAP = {
    # Code
    ".py": {"name": "Python", "color": "#3572A5"},
    ".js": {"name": "JavaScript", "color": "#f1e05a"},
    ".ts": {"name": "TypeScript", "color": "#3178c6"},
    ".jsx": {"name": "React JSX", "color": "#61dafb"},
    ".tsx": {"name": "React TSX", "color": "#3178c6"},
    ".c": {"name": "C", "color": "#555555"},
    ".cpp": {"name": "C++", "color": "#f34b7d"},
    ".h": {"name": "C/C++ Header", "color": "#555555"},
    ".hpp": {"name": "C++ Header", "color": "#f34b7d"},
    ".rs": {"name": "Rust", "color": "#dea584"},
    ".go": {"name": "Go", "color": "#00ADD8"},
    ".java": {"name": "Java", "color": "#b07219"},
    ".kt": {"name": "Kotlin", "color": "#A97BFF"},
    ".swift": {"name": "Swift", "color": "#F05138"},
    ".rb": {"name": "Ruby", "color": "#701516"},
    ".php": {"name": "PHP", "color": "#4F5D95"},
    ".cs": {"name": "C#", "color": "#178600"},
    ".cu": {"name": "CUDA", "color": "#76b900"},
    ".cuh": {"name": "CUDA Header", "color": "#76b900"},
    ".sh": {"name": "Shell", "color": "#89e051"},
    ".bat": {"name": "Batch", "color": "#C1F12E"},
    ".sql": {"name": "SQL", "color": "#e38c00"},
    ".proto": {"name": "Protobuf", "color": "#4285F4"},
    ".zig": {"name": "Zig", "color": "#ec915c"},
    ".lua": {"name": "Lua", "color": "#000080"},
    ".scala": {"name": "Scala", "color": "#c22d40"},
    ".r": {"name": "R", "color": "#198CE7"},
    ".dart": {"name": "Dart", "color": "#00B4AB"},
    ".ex": {"name": "Elixir", "color": "#6e4a7e"},
    ".exs": {"name": "Elixir Script", "color": "#6e4a7e"},
    ".vue": {"name": "Vue", "color": "#41b883"},
    ".svelte": {"name": "Svelte", "color": "#ff3e00"},
    # Config & Data
    ".json": {"name": "JSON", "color": "#292929"},
    ".yaml": {"name": "YAML", "color": "#cb171e"},
    ".yml": {"name": "YAML", "color": "#cb171e"},
    ".toml": {"name": "TOML", "color": "#9c4221"},
    ".xml": {"name": "XML", "color": "#0060ac"},
    ".ini": {"name": "INI", "color": "#d1dbe0"},
    ".cfg": {"name": "Config", "color": "#d1dbe0"},
    ".env": {"name": "Env", "color": "#ECD53F"},
    ".properties": {"name": "Properties", "color": "#2A6277"},
    # Web
    ".html": {"name": "HTML", "color": "#e34c26"},
    ".htm": {"name": "HTML", "color": "#e34c26"},
    ".css": {"name": "CSS", "color": "#563d7c"},
    ".scss": {"name": "SCSS", "color": "#c6538c"},
    ".sass": {"name": "Sass", "color": "#a53b70"},
    ".less": {"name": "Less", "color": "#1d365d"},
    # Docs
    ".md": {"name": "Markdown", "color": "#083fa1"},
    ".rst": {"name": "reStructuredText", "color": "#141414"},
    ".txt": {"name": "Text", "color": "#888888"},
    # Build & CI
    ".dockerfile": {"name": "Dockerfile", "color": "#384d54"},
    ".makefile": {"name": "Makefile", "color": "#427819"},
    ".cmake": {"name": "CMake", "color": "#DA3434"},
    ".gradle": {"name": "Gradle", "color": "#02303A"},
    ".tf": {"name": "Terraform", "color": "#5C4EE5"},
    ".hcl": {"name": "HCL", "color": "#5C4EE5"},
    # Data
    ".csv": {"name": "CSV", "color": "#237346"},
    ".graphql": {"name": "GraphQL", "color": "#e10098"},
    ".prisma": {"name": "Prisma", "color": "#2D3748"},
}

SUPPORTED_EXTENSIONS = set(LANGUAGE_MAP.keys())

# Files without extensions that we should still include
SPECIAL_FILENAMES = {
    "Dockerfile": {"name": "Dockerfile", "color": "#384d54"},
    "Makefile": {"name": "Makefile", "color": "#427819"},
    "Procfile": {"name": "Procfile", "color": "#6e4a7e"},
    "Vagrantfile": {"name": "Vagrantfile", "color": "#1563FF"},
    "Gemfile": {"name": "Gemfile", "color": "#701516"},
    "Rakefile": {"name": "Rakefile", "color": "#701516"},
    "Justfile": {"name": "Justfile", "color": "#384d54"},
    ".gitignore": {"name": "Gitignore", "color": "#F05032"},
    ".dockerignore": {"name": "Dockerignore", "color": "#384d54"},
    "requirements.txt": {"name": "Requirements", "color": "#3572A5"},
    "package.json": {"name": "Package JSON", "color": "#f1e05a"},
    "tsconfig.json": {"name": "TS Config", "color": "#3178c6"},
    "Cargo.toml": {"name": "Cargo Config", "color": "#dea584"},
    "go.mod": {"name": "Go Module", "color": "#00ADD8"},
    "go.sum": {"name": "Go Sum", "color": "#00ADD8"},
    "pyproject.toml": {"name": "PyProject", "color": "#3572A5"},
    "setup.py": {"name": "Setup Script", "color": "#3572A5"},
    "setup.cfg": {"name": "Setup Config", "color": "#3572A5"},
    "docker-compose.yml": {"name": "Docker Compose", "color": "#384d54"},
    "docker-compose.yaml": {"name": "Docker Compose", "color": "#384d54"},
    ".env.example": {"name": "Env Example", "color": "#ECD53F"},
}

IMPORT_PATTERNS = {
    ".py": [r"^import\s+([\w.]+)", r"^from\s+([\w.]+)\s+import"],
    ".js": [r"""(?:import\s+.*?from\s+['"])([\w@/.~-]+)['"]""", r"""(?:require\s*\(\s*['"])([\w@/.~-]+)['"]\s*\))"""],
    ".ts": [r"""(?:import\s+.*?from\s+['"])([\w@/.~-]+)['"]""", r"""(?:require\s*\(\s*['"])([\w@/.~-]+)['"]\s*\))"""],
    ".jsx": [r"""(?:import\s+.*?from\s+['"])([\w@/.~-]+)['"]""", r"""(?:require\s*\(\s*['"])([\w@/.~-]+)['"]\s*\))"""],
    ".tsx": [r"""(?:import\s+.*?from\s+['"])([\w@/.~-]+)['"]""", r"""(?:require\s*\(\s*['"])([\w@/.~-]+)['"]\s*\))"""],
    ".go": [r"""["']([\w./]+)["']"""],
    ".rs": [r"^use\s+([\w:]+)"],
    ".java": [r"^import\s+([\w.]+)"],
    ".c": [r'#include\s*[<"]([\w/.]+)[>"]'],
    ".cpp": [r'#include\s*[<"]([\w/.]+)[>"]'],
    ".h": [r'#include\s*[<"]([\w/.]+)[>"]'],
    ".cu": [r'#include\s*[<"]([\w/.]+)[>"]'],
}

GITHUB_PATTERNS = [
    r"^https?://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/.*)?$",
    r"^git@github\.com:([\w.-]+)/([\w.-]+?)(?:\.git)?$",
    r"^https?://gitlab\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/.*)?$",
    r"^https?://bitbucket\.org/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/.*)?$",
]


# ─────────────────────────────────────────────────────────────────────────────
# DATA MODELS
# ─────────────────────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    directory_path: str = Field(..., description="Local path OR GitHub URL")
    nvidia_api_key: Optional[str] = Field(default=None)
    max_files: int = Field(default=120, ge=1, le=500)
    include_tests: bool = Field(default=False)
    depth: int = Field(default=6, ge=1, le=15)
    analysis_mode: str = Field(default="full")

class QueryRequest(BaseModel):
    directory_path: str
    nvidia_api_key: Optional[str] = None
    question: str
    max_files: int = Field(default=80, ge=1, le=300)

class SaveKeyRequest(BaseModel):
    nvidia_api_key: str = Field(..., min_length=10)

class FileNodeInfo(BaseModel):
    path: str
    relative_path: str
    size_bytes: int
    line_count: int
    extension: str
    language: str
    language_color: str
    last_modified: str
    imports: List[str] = []
    complexity_score: float = 0.0
    has_tests: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# API KEY MANAGER
# ─────────────────────────────────────────────────────────────────────────────
class APIKeyManager:
    @staticmethod
    def get_key(request_key: Optional[str] = None) -> str:
        if request_key and request_key.strip():
            return request_key.strip()
        env_key = os.getenv("NVIDIA_API_KEY", "").strip()
        if env_key:
            return env_key
        raise HTTPException(status_code=400, detail="No API key. Save one via POST /api/v1/save-key or pass nvidia_api_key.")

    @staticmethod
    def save_key(key: str):
        ENV_FILE.touch(exist_ok=True)
        content = ENV_FILE.read_text() if ENV_FILE.exists() else ""
        if "NVIDIA_API_KEY=" in content:
            content = re.sub(r"NVIDIA_API_KEY=.*", f"NVIDIA_API_KEY={key}", content)
        else:
            content += f"\nNVIDIA_API_KEY={key}\n"
        ENV_FILE.write_text(content.strip() + "\n")
        os.environ["NVIDIA_API_KEY"] = key

    @staticmethod
    def has_key() -> bool:
        return bool(os.getenv("NVIDIA_API_KEY", "").strip())


# ─────────────────────────────────────────────────────────────────────────────
# REPO RESOLVER (Local + URL)
# ─────────────────────────────────────────────────────────────────────────────
class RepoResolver:
    @staticmethod
    def is_url(path: str) -> bool:
        path = path.strip()
        return path.startswith("https://") or path.startswith("git@") or path.startswith("http://")

    @staticmethod
    def clone_repo(url: str) -> Tuple[str, str]:
        """Clone repo, return (local_path, repo_name)."""
        url = url.strip().rstrip("/")
        repo_name = "repo"

        for pattern in GITHUB_PATTERNS:
            match = re.match(pattern, url)
            if match:
                owner, repo_name = match.group(1), match.group(2)
                if "github.com" in url:
                    url = f"https://github.com/{owner}/{repo_name}.git"
                elif "gitlab.com" in url:
                    url = f"https://gitlab.com/{owner}/{repo_name}.git"
                elif "bitbucket.org" in url:
                    url = f"https://bitbucket.org/{owner}/{repo_name}.git"
                break

        if not url.endswith(".git"):
            url += ".git"

        url_hash = hashlib.md5(url.encode()).hexdigest()[:10]
        clone_path = CLONE_DIR / f"{repo_name}_{url_hash}"

        if clone_path.exists():
            logger.info(f"Using cached clone: {clone_path}")
            try:
                subprocess.run(["git", "-C", str(clone_path), "pull", "--ff-only"], capture_output=True, timeout=60)
            except Exception:
                pass
            return str(clone_path), repo_name

        logger.info(f"Cloning {url}")
        try:
            result = subprocess.run(
                ["git", "clone", "--depth", "1", url, str(clone_path)],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                raise HTTPException(status_code=400, detail=f"Clone failed: {result.stderr.strip()}")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=408, detail="Clone timed out")
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail="Git not installed")

        return str(clone_path), repo_name

    @staticmethod
    def resolve(path: str) -> str:
        path = path.strip()
        if RepoResolver.is_url(path):
            local_path, _ = RepoResolver.clone_repo(path)
            return local_path
        if not os.path.exists(path):
            raise HTTPException(status_code=400, detail=f"Directory not found: {path}")
        if not os.path.isdir(path):
            raise HTTPException(status_code=400, detail=f"Not a directory: {path}")
        return os.path.abspath(path)


# ─────────────────────────────────────────────────────────────────────────────
# COMPLEXITY ANALYZER
# ─────────────────────────────────────────────────────────────────────────────
class ComplexityAnalyzer:
    BRANCH_KW = {
        ".py": ["if ", "elif ", "else:", "for ", "while ", "except ", "with "],
        ".js": ["if ", "else ", "for ", "while ", "switch ", "case ", "catch "],
        ".ts": ["if ", "else ", "for ", "while ", "switch ", "case ", "catch "],
        ".jsx": ["if ", "else ", "for ", "while ", "switch ", "case ", "catch "],
        ".tsx": ["if ", "else ", "for ", "while ", "switch ", "case ", "catch "],
        ".go": ["if ", "else ", "for ", "switch ", "case ", "select "],
        ".rs": ["if ", "else ", "for ", "while ", "match ", "loop "],
        ".java": ["if ", "else ", "for ", "while ", "switch ", "case ", "catch "],
        ".c": ["if ", "else ", "for ", "while ", "switch ", "case "],
        ".cpp": ["if ", "else ", "for ", "while ", "switch ", "case ", "catch "],
    }

    @staticmethod
    def score(content: str, ext: str) -> float:
        lines = content.split("\n")
        total = len(lines)
        if total == 0:
            return 0.0
        keywords = ComplexityAnalyzer.BRANCH_KW.get(ext, ["if ", "for ", "while "])
        branch_count = sum(1 for l in lines if any(kw in l for kw in keywords))
        max_indent = max((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
        nesting = min(max_indent / 4.0, 10) / 10.0
        density = min(branch_count / max(total, 1), 1.0)
        length = min(math.log10(max(total, 1)) / 4.0, 1.0)
        return round(min((density * 0.4 + nesting * 0.35 + length * 0.25) * 100, 100), 1)


# ─────────────────────────────────────────────────────────────────────────────
# REPOSITORY PROCESSOR
# ─────────────────────────────────────────────────────────────────────────────
class RepositoryProcessor:
    def __init__(self, root: str, max_files=120, include_tests=False, depth=6):
        self.root = root
        self.max_files = max_files
        self.include_tests = include_tests
        self.depth = depth

    def _extract_imports(self, content: str, ext: str) -> List[str]:
        patterns = IMPORT_PATTERNS.get(ext, [])
        imports = []
        for p in patterns:
            imports.extend(re.findall(p, content, re.MULTILINE))
        return list(set(imports))

    def _resolve_import(self, imp: str, all_files: Dict) -> Optional[str]:
        candidates = [
            imp.replace(".", os.sep), imp.replace(".", os.sep) + ".py",
            imp.replace("/", os.sep), imp.replace("/", os.sep) + ".js",
            imp.replace("/", os.sep) + ".ts", imp.replace("/", os.sep) + ".tsx",
            imp.replace("/", os.sep) + ".jsx",
            re.sub(r"^\.\.?/", "", imp),
        ]
        for c in candidates:
            for f in all_files:
                if f.endswith(c) or c in f:
                    return f
        return None

    def generate_tree(self) -> str:
        lines = []
        for root, dirs, files in os.walk(self.root):
            dirs[:] = sorted([d for d in dirs if d not in IGNORE_PATHS])
            level = root.replace(self.root, "").count(os.sep)
            if level >= self.depth:
                del dirs[:]
                continue
            indent = "│   " * level
            lines.append(f"{indent}📂 {os.path.basename(root)}/")
            sub = "│   " * (level + 1)
            for f in sorted(files):
                ext = Path(f).suffix
                if ext in SUPPORTED_EXTENSIONS or f in SPECIAL_FILENAMES:
                    lines.append(f"{sub}📄 {f}")
        return "\n".join(lines)

    def scan_and_read(self) -> Tuple[str, List[FileNodeInfo], Dict]:
        code_parts = []
        meta_list: List[FileNodeInfo] = []
        lang_stats: Dict[str, int] = defaultdict(int)
        total_lines = total_bytes = 0

        for root, dirs, files in os.walk(self.root):
            dirs[:] = sorted([d for d in dirs if d not in IGNORE_PATHS])
            if not self.include_tests:
                dirs[:] = [d for d in dirs if "test" not in d.lower() and "spec" not in d.lower()]

            for fn in sorted(files):
                if len(meta_list) >= self.max_files:
                    break
                fp = Path(root) / fn
                ext = fp.suffix.lower()
                fname = fp.name

                # Check if file is supported by extension OR by special filename
                is_special = fname in SPECIAL_FILENAMES or fname.lower() in {k.lower() for k in SPECIAL_FILENAMES}
                if ext not in SUPPORTED_EXTENSIONS and not is_special:
                    continue

                try:
                    rel = os.path.relpath(fp, self.root)
                    st = fp.stat()
                    # Skip very large files (>200KB)
                    if st.st_size > 200_000:
                        continue
                    content = open(fp, "r", encoding="utf-8", errors="ignore").read()
                    lns = content.split("\n")

                    # Resolve language info
                    if is_special and ext not in SUPPORTED_EXTENSIONS:
                        info = SPECIAL_FILENAMES.get(fname, {"name": "Config", "color": "#888"})
                    else:
                        info = LANGUAGE_MAP.get(ext, {"name": "Unknown", "color": "#888"})
                    imports = self._extract_imports(content, ext)
                    cx = ComplexityAnalyzer.score(content, ext)
                    lang_stats[info["name"]] += len(lns)
                    total_lines += len(lns)
                    total_bytes += st.st_size

                    meta_list.append(FileNodeInfo(
                        path=str(fp), relative_path=rel, size_bytes=st.st_size,
                        line_count=len(lns), extension=ext, language=info["name"],
                        language_color=info["color"],
                        last_modified=datetime.fromtimestamp(st.st_mtime).isoformat(),
                        imports=imports, complexity_score=cx,
                        has_tests="test" in rel.lower(),
                    ))

                    show = content if len(lns) <= 200 else "\n".join(lns[:120] + ["...(truncated)..."] + lns[-50:])
                    code_parts.append(f"\n--- FILE: {rel} | {info['name']} | {len(lns)} lines | complexity={cx} ---\n{show}\n")
                except Exception as e:
                    logger.error(f"Read error {fn}: {e}")

        # Dependency links
        dep_links = []
        all_rels = {m.relative_path: m for m in meta_list}
        for m in meta_list:
            for imp in m.imports:
                target = self._resolve_import(imp, all_rels)
                if target and target != m.relative_path:
                    dep_links.append({"source": m.relative_path, "target": target, "type": "imports", "raw": imp})

        # Hotspots
        by_cx = sorted(meta_list, key=lambda f: f.complexity_score, reverse=True)
        hotspots = [{"file": f.relative_path, "complexity": f.complexity_score, "lines": f.line_count, "language": f.language} for f in by_cx[:5]]

        # Most connected
        conn = defaultdict(int)
        for l in dep_links:
            conn[l["source"]] += 1
            conn[l["target"]] += 1
        most_conn = [{"file": f, "connections": c} for f, c in sorted(conn.items(), key=lambda x: x[1], reverse=True)[:5]]

        summary = {
            "name": os.path.basename(self.root),
            "total_files": len(meta_list), "total_lines": total_lines, "total_bytes": total_bytes,
            "languages": dict(lang_stats), "dependency_links": dep_links,
            "hotspots": hotspots, "most_connected": most_conn,
            "avg_complexity": round(sum(m.complexity_score for m in meta_list) / max(len(meta_list), 1), 1),
        }

        tree = self.generate_tree()
        payload = f"REPOSITORY: {summary['name']}\nLANGUAGES: {json.dumps(summary['languages'])}\n"
        payload += f"FILES: {summary['total_files']} | LINES: {total_lines}\nAVG COMPLEXITY: {summary['avg_complexity']}/100\n\n"
        payload += f"STRUCTURE:\n{tree}\n\nIMPORT DEPS:\n{json.dumps(dep_links, indent=2)}\n\n"

        # Smart truncation: keep total payload under ~80K tokens (~320K chars)
        # Priority: high complexity files get more space, low complexity get less
        MAX_PAYLOAD_CHARS = 300_000
        header_len = len(payload)
        remaining = MAX_PAYLOAD_CHARS - header_len

        if remaining <= 0:
            # Even header is too large, trim tree
            payload = f"REPOSITORY: {summary['name']}\nFILES: {summary['total_files']}\n\n"
            remaining = MAX_PAYLOAD_CHARS - len(payload)

        # Sort code parts by importance: higher complexity = more important
        sorted_files = sorted(
            zip(meta_list, code_parts),
            key=lambda x: x[0].complexity_score + (100 if any(e in x[0].relative_path.lower() for e in ["main", "app", "index", "server"]) else 0),
            reverse=True
        )

        # First pass: include all files but truncate each proportionally
        total_code = sum(len(p) for _, p in sorted_files)
        final_parts = []

        if total_code <= remaining:
            # Everything fits
            final_parts = [p for _, p in sorted_files]
        else:
            # Budget per file based on importance rank
            used = 0
            for i, (meta, part) in enumerate(sorted_files):
                # Top files get more budget, bottom files get summaries only
                if i < 5:
                    # Important files: up to 60K chars each, or whatever's left
                    budget = min(len(part), 60_000, remaining - used)
                elif i < 15:
                    # Medium files: up to 10K chars each
                    budget = min(len(part), 10_000, remaining - used)
                else:
                    # Lower priority: just first 80 lines (~3K chars)
                    lines = part.split("\n")
                    trimmed = "\n".join(lines[:80])
                    if len(lines) > 80:
                        trimmed += "\n...(truncated to first 80 lines)...\n"
                    budget = min(len(trimmed), 3_000, remaining - used)
                    part = trimmed

                if budget <= 0:
                    # Add just the header line so Nemotron knows the file exists
                    header_line = part.split("\n")[0] if part else f"--- FILE: {meta.relative_path} (content omitted - token limit) ---"
                    final_parts.append(header_line + "\n")
                    used += len(header_line) + 1
                else:
                    truncated = part[:budget]
                    if len(part) > budget:
                        truncated += "\n...(truncated)...\n"
                    final_parts.append(truncated)
                    used += len(truncated)

        payload += "".join(final_parts)

        # Final safety check
        if len(payload) > MAX_PAYLOAD_CHARS:
            payload = payload[:MAX_PAYLOAD_CHARS] + "\n\n...(payload truncated to fit context window)..."

        logger.info(f"Payload size: {len(payload)} chars (~{len(payload)//4} tokens)")

        return payload, meta_list, summary


# ─────────────────────────────────────────────────────────────────────────────
# NEMOTRON ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────
class NemotronOrchestrator:
    def __init__(self, api_key: str):
        self.client = OpenAI(base_url=NVIDIA_BASE_URL, api_key=api_key)

    SYS_ARCH = """You are the Nemotron Mamba-Hybrid Architect analyzing a codebase to generate a 3D architectural map.

YOUR TASK:
1. Read all files listed below
2. Identify the IMPORTANT files — source code, key configs, main entry points
3. Create a node for EACH important file
4. Map ALL relationships between them — imports, function calls, data flow, config usage
5. Provide architectural analysis

OUTPUT FORMAT: Write your reasoning first, then output ONE raw JSON object (absolutely NO markdown backticks).

THE JSON MUST FOLLOW THIS EXACT SCHEMA:
{
  "nodes": [
    {
      "id": "unique_string_id",
      "name": "filename.ext",
      "type": "star or planet or moon or satellite",
      "group": "module_group_name",
      "language": "Python",
      "color": "#hex_color",
      "val": 10,
      "complexity": 35,
      "details": {
        "purpose": "What this file does in 1-2 sentences",
        "pattern": "Design pattern used",
        "classes": ["ClassName1", "ClassName2"],
        "functions": ["func1", "func2", "func3"],
        "key_dependencies": ["dep1", "dep2"],
        "quality_notes": "Code quality observations"
      }
    }
  ],
  "links": [
    {
      "source": "source_node_id",
      "target": "target_node_id",
      "relationship": "imports",
      "strength": 0.8,
      "label": "imports FastAPI for routing"
    }
  ],
  "architecture": {
    "pattern": "Overall architecture pattern name",
    "summary": "2-3 sentence summary of how the codebase works",
    "strengths": ["strength1", "strength2"],
    "concerns": ["concern1", "concern2"],
    "suggestions": ["suggestion1", "suggestion2"]
  }
}

NODE TYPE GUIDE:
- "star" with color "#76b900" and val 15-20 = entry points, main application files
- "planet" with color "#3b82f6" and val 8-14 = core business logic, components
- "moon" with color "#a78bfa" and val 4-7 = utilities, helpers, services  
- "satellite" with color "#94a3b8" and val 1-3 = config, assets, data files

LINK RULES:
- Include EVERY import/require/include relationship
- Include implicit connections: config files that configure modules, CSS that styles components, test files that test modules
- The "label" field must describe WHAT the connection does (e.g. "imports face detection class", "configures database URL", "styles the dashboard layout")
- "strength" ranges from 0.1 (weak/indirect) to 1.0 (critical dependency)

IMPORTANT: Make sure source and target in links match actual node ids. Every link must connect two existing nodes.

Return ONLY reasoning text followed by raw JSON. No markdown code fences."""

    SYS_QUERY = "You are the Nemotron Code Navigator. Answer questions about the codebase accurately, referencing file names. Be concise."

    SYS_SECURITY = """You are Nemotron Security Auditor. Analyze the provided codebase for security vulnerabilities.

For each issue found, provide:
- severity: "critical", "high", "medium", or "low"
- file: which file contains the issue
- line_hint: approximate description of where (e.g. "in the database connection function")
- vulnerability: type of vulnerability (e.g. "SQL Injection", "Hardcoded Secret", "Path Traversal")
- description: clear explanation of the risk
- fix: specific recommendation to fix it

OUTPUT FORMAT: Reasoning first, then ONE raw JSON (NO markdown fences):
{
  "vulnerabilities": [
    {
      "severity": "critical",
      "file": "db.py",
      "line_hint": "in connect_db function",
      "vulnerability": "Hardcoded Database Password",
      "description": "Database password is hardcoded as a string literal instead of using environment variables",
      "fix": "Use os.environ or a secrets manager to load credentials"
    }
  ],
  "security_score": 72,
  "summary": "Overall security assessment in 2-3 sentences",
  "positive": ["What the codebase does well security-wise"]
}

Check for: hardcoded secrets/passwords/API keys, SQL injection, command injection, path traversal, insecure deserialization, missing input validation, unsafe file operations, CORS misconfig, missing auth/authz, insecure random, debug mode in production, exposed stack traces, missing HTTPS, SSRF risks, XSS vulnerabilities.

Return raw JSON after reasoning. No markdown fences."""

    SYS_ONBOARDING = """You are Nemotron Onboarding Guide. Create a guided walkthrough of this codebase as if you're a senior developer explaining the project to a new team member on their first day.

OUTPUT FORMAT: Reasoning first, then ONE raw JSON (NO markdown fences):
{
  "project_name": "Name of the project",
  "one_liner": "What this project does in one sentence",
  "tech_stack": ["Python", "FastAPI", "PyTorch"],
  "steps": [
    {
      "order": 1,
      "title": "Start Here: Entry Point",
      "file": "main.py",
      "description": "This is where the application starts. It sets up the FastAPI server and defines all API routes.",
      "key_things": ["The app factory pattern", "Route definitions", "Middleware setup"],
      "next_hint": "From here, requests flow to the processor module..."
    },
    {
      "order": 2,
      "title": "Core Business Logic",
      "file": "processor.py",
      "description": "...",
      "key_things": ["...", "..."],
      "next_hint": "The processor uses utilities from..."
    }
  ],
  "architecture_diagram": "A simple text-based flow: main.py → processor.py → utils/ → database",
  "first_task": "If you wanted to add a new feature, start by... Here's exactly what you'd do step by step.",
  "gotchas": ["Watch out for...", "Don't forget to..."]
}

Make the walkthrough follow the actual data/control flow. Start from the entry point and trace through the code logically. Be specific — reference actual class names, function names, and file names. Make it feel like a real senior dev talking.

Return raw JSON after reasoning. No markdown fences."""

    SYS_CUDA = """You are Nemotron GPU/CUDA Performance Analyst — an NVIDIA specialist in GPU-accelerated code optimization.

Analyze the provided codebase for GPU/CUDA usage patterns, performance bottlenecks, and optimization opportunities.

Look for:
- CUDA kernels (global, device, shared memory usage)
- PyTorch/TensorFlow GPU operations (.cuda(), .to(device), torch.nn operations)
- Memory transfer patterns (host↔device, pinned memory)
- Batch processing efficiency
- Mixed precision / AMP usage
- DataLoader parallelism (num_workers, pin_memory)
- Model parallelism / distributed training patterns
- Unnecessary CPU↔GPU transfers
- Memory leaks or inefficient allocations
- Kernel launch configurations (grid/block sizing)

OUTPUT FORMAT: Reasoning first, then ONE raw JSON (NO markdown fences):
{
  "gpu_usage_detected": true,
  "framework": "PyTorch",
  "gpu_score": 68,
  "findings": [
    {
      "category": "memory_transfer",
      "severity": "high",
      "file": "train.py",
      "location": "in training loop",
      "issue": "Repeated .cpu() calls inside training loop cause unnecessary GPU→CPU transfers",
      "impact": "Can cause 2-5x slowdown due to synchronization overhead",
      "fix": "Accumulate metrics on GPU and transfer once after epoch",
      "estimated_speedup": "2-3x for this section"
    }
  ],
  "optimizations": [
    {
      "title": "Enable Mixed Precision Training",
      "description": "The training loop uses float32 throughout. Using torch.cuda.amp would reduce memory usage by ~50% and speed up training by 1.5-3x on Tensor Core GPUs.",
      "effort": "low",
      "impact": "high",
      "code_hint": "Wrap forward pass with torch.cuda.amp.autocast()"
    }
  ],
  "memory_profile": {
    "estimated_gpu_memory": "Description of memory usage patterns",
    "bottlenecks": ["List of memory bottlenecks"],
    "recommendations": ["How to reduce memory usage"]
  },
  "summary": "2-3 sentence overall GPU performance assessment"
}

If no GPU/CUDA code is found, still analyze if the codebase COULD benefit from GPU acceleration and suggest where.

Return raw JSON after reasoning. No markdown fences."""

    async def _stream_generic(self, system_prompt: str, payload: str, event_type: str = "content"):
        """Generic streaming method for all analysis types."""
        try:
            stream = self.client.chat.completions.create(
                model=NVIDIA_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": payload},
                ],
                temperature=0.35, top_p=0.9, max_tokens=8192, stream=True,
            )
            for chunk in stream:
                d = chunk.choices[0].delta if chunk.choices else None
                if not d:
                    continue
                r = getattr(d, "reasoning_content", None)
                if r:
                    yield f"data: {json.dumps({'type':'thought','content':r})}\n\n"
                if d.content:
                    yield f"data: {json.dumps({'type': event_type, 'content': d.content})}\n\n"
                await asyncio.sleep(0.003)
            yield f"data: {json.dumps({'type':'done'})}\n\n"
        except Exception as e:
            logger.error(f"NIM Error: {e}")
            yield f"data: {json.dumps({'type':'error','content':str(e)})}\n\n"

    async def stream_arch(self, payload: str):
        async for event in self._stream_generic(self.SYS_ARCH, f"Analyze:\n\n{payload}", "content"):
            yield event

    async def stream_query(self, payload: str, question: str):
        prompt = f"CODEBASE:\n{payload}\n\nQ: {question}"
        async for event in self._stream_generic(self.SYS_QUERY, prompt, "answer"):
            yield event

    async def stream_security(self, payload: str):
        async for event in self._stream_generic(self.SYS_SECURITY, f"Audit this codebase:\n\n{payload}", "content"):
            yield event

    async def stream_onboarding(self, payload: str):
        async for event in self._stream_generic(self.SYS_ONBOARDING, f"Create onboarding guide:\n\n{payload}", "content"):
            yield event

    async def stream_cuda(self, payload: str):
        async for event in self._stream_generic(self.SYS_CUDA, f"Analyze GPU/CUDA usage:\n\n{payload}", "content"):
            yield event


# ─────────────────────────────────────────────────────────────────────────────
# FASTAPI
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Mamba-Graph Pro", version="3.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
async def health():
    return {"status": "online", "engine": NVIDIA_MODEL, "version": "3.1.0", "has_api_key": APIKeyManager.has_key()}


@app.post("/api/v1/save-key")
async def save_key(req: SaveKeyRequest):
    APIKeyManager.save_key(req.nvidia_api_key)
    return {"status": "saved", "message": "Key saved to .env — you won't need to enter it again."}


@app.get("/api/v1/check-key")
async def check_key():
    return {"has_key": APIKeyManager.has_key()}


@app.post("/api/v1/preview")
async def preview(req: AnalyzeRequest):
    try:
        path = RepoResolver.resolve(req.directory_path)
        proc = RepositoryProcessor(path, req.max_files, req.include_tests, req.depth)
        _, files, summary = proc.scan_and_read()
        return {"summary": summary, "files": [f.dict() for f in files]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/analyze")
async def analyze(req: AnalyzeRequest):
    try:
        api_key = APIKeyManager.get_key(req.nvidia_api_key)
        path = RepoResolver.resolve(req.directory_path)
        proc = RepositoryProcessor(path, req.max_files, req.include_tests, req.depth)
        payload, files, summary = proc.scan_and_read()
        if not files:
            raise HTTPException(status_code=400, detail="No source files found.")

        # Build explicit file list for Nemotron to reference
        file_list = []
        for f in files:
            file_list.append(f"{f.relative_path} ({f.language}, {f.line_count} lines, complexity={f.complexity_score})")

        file_list_str = "\n".join([f"  {i+1}. {fl}" for i, fl in enumerate(file_list)])
        dep_list_str = "\n".join([f"  - {d['source']} → {d['target']} (imports {d.get('raw','')})" for d in summary.get("dependency_links", [])])

        # Build focused payload with numbered file list
        focused_payload = f"""REPOSITORY: {summary['name']}
TOTAL FILES: {len(files)} | TOTAL LINES: {summary['total_lines']}

ALL {len(files)} FILES (numbered):
{file_list_str}

IMPORT DEPENDENCIES FOUND:
{dep_list_str if dep_list_str else '  (none detected statically)'}

{payload}"""

        orch = NemotronOrchestrator(api_key)

        async def gen():
            yield f"data: {json.dumps({'type': 'metadata', 'content': summary})}\n\n"
            # Also send file list so frontend can show it
            yield f"data: {json.dumps({'type': 'file_list', 'content': [f.dict() for f in files]})}\n\n"
            async for ev in orch.stream_arch(focused_payload):
                yield ev

        return StreamingResponse(gen(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/query")
async def query(req: QueryRequest):
    try:
        api_key = APIKeyManager.get_key(req.nvidia_api_key)
        path = RepoResolver.resolve(req.directory_path)
        proc = RepositoryProcessor(path, req.max_files)
        payload, files, _ = proc.scan_and_read()
        if not files:
            raise HTTPException(status_code=400, detail="No source files found.")
        orch = NemotronOrchestrator(api_key)
        return StreamingResponse(orch.stream_query(payload, req.question), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/export/mermaid")
async def mermaid(req: AnalyzeRequest):
    path = RepoResolver.resolve(req.directory_path)
    proc = RepositoryProcessor(path, req.max_files, req.include_tests, req.depth)
    _, files, summary = proc.scan_and_read()
    lines = ["graph TD"]
    ids = {}
    for i, f in enumerate(files):
        ids[f.relative_path] = f"N{i}"
        lines.append(f'    N{i}["{f.relative_path}"]')
    for link in summary["dependency_links"]:
        s, t = ids.get(link["source"]), ids.get(link["target"])
        if s and t:
            lines.append(f"    {s} -->|imports| {t}")
    return {"mermaid": "\n".join(lines), "summary": summary}


@app.delete("/api/v1/cache")
async def clear_cache():
    count = sum(1 for d in CLONE_DIR.iterdir() if d.is_dir())
    shutil.rmtree(CLONE_DIR, ignore_errors=True)
    CLONE_DIR.mkdir(exist_ok=True)
    return {"cleared": count}


# ─── Security Scan ───

@app.post("/api/v1/security")
async def security_scan(req: AnalyzeRequest):
    """Nemotron-powered security vulnerability scan."""
    try:
        api_key = APIKeyManager.get_key(req.nvidia_api_key)
        path = RepoResolver.resolve(req.directory_path)
        proc = RepositoryProcessor(path, req.max_files, req.include_tests, req.depth)
        payload, files, summary = proc.scan_and_read()
        if not files:
            raise HTTPException(status_code=400, detail="No source files found.")
        orch = NemotronOrchestrator(api_key)

        async def gen():
            yield f"data: {json.dumps({'type': 'metadata', 'content': {'total_files': len(files), 'name': summary['name']}})}\n\n"
            async for ev in orch.stream_security(payload):
                yield ev

        return StreamingResponse(gen(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Onboarding Guide ───

@app.post("/api/v1/onboarding")
async def onboarding_guide(req: AnalyzeRequest):
    """Nemotron-powered new developer onboarding walkthrough."""
    try:
        api_key = APIKeyManager.get_key(req.nvidia_api_key)
        path = RepoResolver.resolve(req.directory_path)
        proc = RepositoryProcessor(path, req.max_files, req.include_tests, req.depth)
        payload, files, summary = proc.scan_and_read()
        if not files:
            raise HTTPException(status_code=400, detail="No source files found.")
        orch = NemotronOrchestrator(api_key)

        async def gen():
            yield f"data: {json.dumps({'type': 'metadata', 'content': {'total_files': len(files), 'name': summary['name']}})}\n\n"
            async for ev in orch.stream_onboarding(payload):
                yield ev

        return StreamingResponse(gen(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── CUDA/GPU Analysis ───

@app.post("/api/v1/cuda")
async def cuda_analysis(req: AnalyzeRequest):
    """Nemotron-powered GPU/CUDA performance analysis."""
    try:
        api_key = APIKeyManager.get_key(req.nvidia_api_key)
        path = RepoResolver.resolve(req.directory_path)
        proc = RepositoryProcessor(path, req.max_files, req.include_tests, req.depth)
        payload, files, summary = proc.scan_and_read()
        if not files:
            raise HTTPException(status_code=400, detail="No source files found.")
        orch = NemotronOrchestrator(api_key)

        async def gen():
            yield f"data: {json.dumps({'type': 'metadata', 'content': {'total_files': len(files), 'name': summary['name'], 'languages': summary['languages']}})}\n\n"
            async for ev in orch.stream_cuda(payload):
                yield ev

        return StreamingResponse(gen(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)