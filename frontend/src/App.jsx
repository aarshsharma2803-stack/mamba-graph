import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { motion, AnimatePresence } from "framer-motion";
import * as THREE from "three";
import {
  Cpu, Terminal, Play, Key, Activity, X,
  Search, Download, MessageSquare, Send, BarChart3,
  FileCode2, GitBranch, Layers, Flame, Globe, Box,
  ArrowRight, Save, Check, Link2, FolderOpen, AlertTriangle,
  ChevronDown, ChevronUp, Shield, BookOpen, Gauge, CheckCircle
} from "lucide-react";

const API = "http://127.0.0.1:8000/api/v1";

// ─── Demo Data ────────────────────────────────────────────────────────────
const DEMO_GRAPH = {
  nodes: [
    { id: "main", name: "main.py", type: "star", group: "core", language: "Python", color: "#6366f1", val: 18, complexity: 35, details: { purpose: "FastAPI entry point & routes", pattern: "Router", classes: ["RepositoryProcessor", "NemotronOrchestrator"], functions: ["analyze_repo", "health", "preview", "query"], key_dependencies: ["fastapi", "openai"], quality_notes: "Well-structured" }},
    { id: "app", name: "App.jsx", type: "star", group: "frontend", language: "React JSX", color: "#61dafb", val: 16, complexity: 48, details: { purpose: "3D force graph visualization UI", pattern: "Component", classes: [], functions: ["App", "runScan", "handleNodeClick"], key_dependencies: ["react-force-graph-3d", "three"], quality_notes: "Large component" }},
    { id: "processor", name: "RepositoryProcessor", type: "planet", group: "core", language: "Python", color: "#3b82f6", val: 12, complexity: 42, details: { purpose: "Scans filesystem, resolves imports", pattern: "Processor", classes: ["RepositoryProcessor"], functions: ["scan_and_read", "generate_tree"], key_dependencies: ["pathlib"], quality_notes: "Solid" }},
    { id: "orchestrator", name: "NemotronOrchestrator", type: "planet", group: "ai", language: "Python", color: "#a78bfa", val: 10, complexity: 28, details: { purpose: "Nemotron API streaming", pattern: "Orchestrator", classes: ["NemotronOrchestrator"], functions: ["stream_arch", "stream_query"], key_dependencies: ["openai"], quality_notes: "Clean async" }},
    { id: "complexity", name: "ComplexityAnalyzer", type: "moon", group: "analysis", language: "Python", color: "#f59e0b", val: 6, complexity: 15, details: { purpose: "Heuristic complexity scoring", pattern: "Analyzer", classes: ["ComplexityAnalyzer"], functions: ["score"], key_dependencies: [], quality_notes: "Extendable" }},
    { id: "models", name: "Data Models", type: "satellite", group: "core", language: "Python", color: "#94a3b8", val: 4, complexity: 8, details: { purpose: "Pydantic schemas", pattern: "Schema", classes: ["AnalyzeRequest", "FileNodeInfo"], functions: [], key_dependencies: ["pydantic"], quality_notes: "Good validation" }},
  ],
  links: [
    { source: "main", target: "processor", relationship: "uses", strength: 0.9, label: "creates instance" },
    { source: "main", target: "orchestrator", relationship: "uses", strength: 0.9, label: "streams analysis" },
    { source: "main", target: "models", relationship: "imports", strength: 0.7, label: "request schemas" },
    { source: "processor", target: "complexity", relationship: "calls", strength: 0.6, label: "scores files" },
    { source: "processor", target: "models", relationship: "imports", strength: 0.5, label: "FileNodeInfo" },
    { source: "app", target: "main", relationship: "calls", strength: 0.8, label: "HTTP/SSE" },
  ],
  architecture: { pattern: "Client-Server + AI Pipeline", summary: "FastAPI backend scans repos and streams Nemotron analysis via SSE to a React 3D graph frontend.", strengths: ["Real-time streaming", "Multi-language", "Complexity analysis"], concerns: ["Large frontend component", "No caching"], suggestions: ["Add Redis cache", "Split App.jsx"] },
};

const TYPE_COLORS = { star: "#6366f1", planet: "#3b82f6", moon: "#a78bfa", satellite: "#64748b" };
const CX_GRAD = [{ t: 0, c: "#22c55e" }, { t: 25, c: "#84cc16" }, { t: 50, c: "#f59e0b" }, { t: 75, c: "#f97316" }, { t: 90, c: "#ef4444" }];
const getCxColor = (s) => { for (let i = CX_GRAD.length - 1; i >= 0; i--) if (s >= CX_GRAD[i].t) return CX_GRAD[i].c; return CX_GRAD[0].c; };

// SSE parser helper
async function streamSSE(url, body, { onThought, onContent, onMeta, onFileList, onDone, onError }) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(e.detail || `HTTP ${res.status}`); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", jsonBuf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "metadata" && onMeta) onMeta(ev.content);
        else if (ev.type === "file_list" && onFileList) onFileList(ev.content);
        else if (ev.type === "thought" && onThought) onThought(ev.content);
        else if ((ev.type === "content" || ev.type === "answer") ) { jsonBuf += ev.content; if (onContent) onContent(ev.content); }
        else if (ev.type === "done" && onDone) onDone();
        else if (ev.type === "error" && onError) onError(ev.content);
      } catch {}
    }
  }
  return jsonBuf;
}

// Robust JSON parser — handles common LLM output issues
function repairAndParseJSON(raw) {
  // Extract JSON object from text (skip reasoning text before it)
  let s = raw.indexOf("{");
  let e = raw.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  let jsonStr = raw.slice(s, e + 1);

  // Try direct parse first
  try { return JSON.parse(jsonStr); } catch {}

  // Fix 1: Remove trailing commas before ] or }
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");

  // Fix 2: Fix unescaped newlines inside strings
  jsonStr = jsonStr.replace(/(?<=":[ ]*"[^"]*)\n([^"]*")/g, "\\n$1");

  // Try again
  try { return JSON.parse(jsonStr); } catch {}

  // Fix 3: Truncated JSON — try to close open brackets/braces
  let open = 0, openArr = 0;
  for (const ch of jsonStr) { if (ch === "{") open++; if (ch === "}") open--; if (ch === "[") openArr++; if (ch === "]") openArr--; }

  let fixed = jsonStr;
  // Remove any trailing incomplete key-value pair
  fixed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*[^}\]]*$/, "");
  while (openArr > 0) { fixed += "]"; openArr--; }
  while (open > 0) { fixed += "}"; open--; }

  // Fix trailing commas again after truncation repair
  fixed = fixed.replace(/,\s*([\]}])/g, "$1");

  try { return JSON.parse(fixed); } catch {}

  // Fix 4: Try extracting just nodes array if full parse fails
  const nodesMatch = raw.match(/"nodes"\s*:\s*\[([\s\S]*?)\]/);
  if (nodesMatch) {
    try {
      let nodesStr = "[" + nodesMatch[1] + "]";
      nodesStr = nodesStr.replace(/,\s*]/g, "]");
      const nodes = JSON.parse(nodesStr);
      return { nodes, links: [], architecture: null };
    } catch {}
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const fgRef = useRef();
  const termRef = useRef();
  const queryRef = useRef();

  // Core
  const [repoPath, setRepoPath] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [thoughts, setThoughts] = useState("");
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [architecture, setArchitecture] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [repoMeta, setRepoMeta] = useState(null);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({ nodes: 0, links: 0, time: 0 });

  // UI
  const [colorMode, setColorMode] = useState("type");
  const [leftTab, setLeftTab] = useState("terminal");
  const [bottomTab, setBottomTab] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredLink, setHoveredLink] = useState(null);

  // Query
  const [queryInput, setQueryInput] = useState("");
  const [queryAnswer, setQueryAnswer] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);

  // Animation
  const [animatedGraph, setAnimatedGraph] = useState({ nodes: [], links: [] });
  const animRef = useRef(null);

  // Feature panels
  const [securityData, setSecurityData] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityThoughts, setSecurityThoughts] = useState("");
  const [onboardingData, setOnboardingData] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingThoughts, setOnboardingThoughts] = useState("");
  const [cudaData, setCudaData] = useState(null);
  const [cudaLoading, setCudaLoading] = useState(false);
  const [cudaThoughts, setCudaThoughts] = useState("");

  const isUrl = repoPath.startsWith("http") || repoPath.startsWith("git@");

  // Auto-scroll refs
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [thoughts]);
  useEffect(() => { if (queryRef.current) queryRef.current.scrollTop = queryRef.current.scrollHeight; }, [queryAnswer]);

  // Check saved key
  useEffect(() => { fetch(`${API}/check-key`).then(r => r.json()).then(d => { if (d.has_key) setKeySaved(true); }).catch(() => {}); }, []);

  // Animate graph reveal
  useEffect(() => {
    if (!graphData.nodes.length) { setAnimatedGraph({ nodes: [], links: [] }); return; }
    if (animRef.current) clearInterval(animRef.current);
    const all = [...graphData.nodes], allL = [...graphData.links];
    let idx = 0;
    setAnimatedGraph({ nodes: [], links: [] });
    animRef.current = setInterval(() => {
      idx++;
      if (idx >= all.length) { setAnimatedGraph({ nodes: all, links: allL }); clearInterval(animRef.current); return; }
      const vis = all.slice(0, idx);
      const ids = new Set(vis.map(n => n.id));
      setAnimatedGraph({ nodes: vis, links: allL.filter(l => ids.has(typeof l.source === "object" ? l.source.id : l.source) && ids.has(typeof l.target === "object" ? l.target.id : l.target)) });
    }, 180);
    return () => { if (animRef.current) clearInterval(animRef.current); };
  }, [graphData]);

  const saveKey = async () => { if (!apiKey.trim()) return; try { const r = await fetch(`${API}/save-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nvidia_api_key: apiKey }) }); if (r.ok) setKeySaved(true); } catch {} };

  const getColor = useCallback((n) => {
    if (colorMode === "complexity") return getCxColor(n.complexity || 0);
    if (colorMode === "language") { const m = { Python: "#3572A5", "React JSX": "#61dafb", JavaScript: "#f1e05a", TypeScript: "#3178c6", Rust: "#dea584", Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", CUDA: "#76b900" }; return m[n.language] || "#64748b"; }
    return TYPE_COLORS[n.type] || "#64748b";
  }, [colorMode]);

  const nodeObj = useCallback((node) => {
    const c = getColor(node);
    const sz = node.type === "star" ? 9 : node.type === "planet" ? 6.5 : node.type === "moon" ? 4.5 : 2.5;
    const hl = searchQuery && node.name.toLowerCase().includes(searchQuery.toLowerCase());
    const geo = node.type === "star" ? new THREE.IcosahedronGeometry(sz, 1) : new THREE.SphereGeometry(sz, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: hl ? "#fff" : c, emissive: hl ? "#fff" : c, emissiveIntensity: hl ? 1.2 : (node.type === "star" ? 0.7 : 0.35), roughness: 0.3, metalness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    if (node.type === "star") { const rg = new THREE.RingGeometry(sz * 1.3, sz * 1.5, 32); mesh.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.2, side: THREE.DoubleSide }))); }
    return mesh;
  }, [getColor, searchQuery]);

  const flyTo = useCallback((node) => { const r = 1 + 100 / Math.hypot(node.x, node.y, node.z); fgRef.current?.cameraPosition({ x: node.x * r, y: node.y * r, z: node.z * r }, node, 1000); setSelectedNode(node); }, []);

  const createLinkLabel = useCallback((text) => {
    if (!text) return null;
    const c = document.createElement("canvas"); const ctx = c.getContext("2d");
    c.width = 512; c.height = 48;
    ctx.fillStyle = "rgba(10,10,15,0.9)"; ctx.roundRect(2, 2, 508, 44, 4); ctx.fill();
    ctx.strokeStyle = "rgba(99,102,241,0.4)"; ctx.lineWidth = 1; ctx.roundRect(2, 2, 508, 44, 4); ctx.stroke();
    ctx.font = "600 20px Inter, sans-serif"; ctx.fillStyle = "#c4c4d4"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text.length > 32 ? text.slice(0, 30) + ".." : text, 256, 24);
    const tex = new THREE.CanvasTexture(c); tex.needsUpdate = true; return tex;
  }, []);

  // ─── Load Demo ───
  const loadDemo = () => {
    setGraphData(DEMO_GRAPH); setArchitecture(DEMO_GRAPH.architecture);
    setStats({ nodes: 6, links: 6, time: "0.00" });
    setRepoMeta({ name: "mamba-graph", total_files: 8, total_lines: 1247, languages: { Python: 680, "React JSX": 420, CSS: 147 }, avg_complexity: 24.1, dependency_links: [], hotspots: [], most_connected: [] });
    setThoughts("[DEMO] Loaded sample architecture.\n");
    setTimeout(() => fgRef.current?.zoomToFit(1000, 100), 400);
  };

  // ─── Main Scan ───
  const runScan = async () => {
    if (!repoPath) return setError("Enter a path or GitHub URL.");
    if (!keySaved && !apiKey) return setError("Enter NVIDIA API key first.");
    const t0 = Date.now();
    setIsScanning(true); setError(""); setSelectedNode(null); setArchitecture(null); setRepoMeta(null);
    setThoughts(isUrl ? "Cloning repository...\n" : "Scanning directory...\n");
    setGraphData({ nodes: [], links: [] }); setLeftTab("terminal");
    let fileList = null;
    try {
      const body = { directory_path: repoPath, max_files: 120 };
      if (apiKey && !keySaved) body.nvidia_api_key = apiKey;
      const rawJson = await streamSSE(`${API}/analyze`, body, {
        onMeta: (m) => { setRepoMeta(m); setThoughts(p => p + `${m.total_files} files · ${m.total_lines} lines · ${Object.keys(m.languages).length} languages\n`); },
        onFileList: (fl) => { fileList = fl; setThoughts(p => p + `Nemotron analyzing ${fl.length} files...\n`); },
        onThought: (t) => setThoughts(p => p + t),
        onDone: () => { setThoughts(p => p + "\nAnalysis complete.\n"); },
        onError: (e) => { throw new Error(e); },
      });

      // Parse with robust repair
      const parsed = repairAndParseJSON(rawJson);
      if (parsed && parsed.nodes) {
        let nodes = parsed.nodes || [], links = parsed.links || [];
        // Fallback fill if Nemotron returned too few
        if (fileList && nodes.length < fileList.length * 0.4) {
          const eIds = new Set(nodes.map(n => n.id)), eNames = new Set(nodes.map(n => n.name));
          for (const f of fileList) {
            const fn = f.relative_path.split("/").pop();
            if (!eIds.has(f.relative_path) && !eIds.has(fn) && !eNames.has(fn)) {
              const isE = /^(main|app|index|server)\./i.test(fn), isC = [".py",".js",".ts",".jsx",".tsx",".java",".go",".rs",".cpp",".c",".cu"].includes(f.extension);
              nodes.push({ id: f.relative_path, name: fn, type: isE ? "star" : isC ? "planet" : "satellite", group: "auto", language: f.language, color: isE ? "#6366f1" : isC ? "#3b82f6" : "#64748b", val: isE ? 14 : isC ? 8 : 3, complexity: f.complexity_score, details: { purpose: "", pattern: "", classes: [], functions: [], key_dependencies: f.imports || [], quality_notes: "" } });
            }
          }
        }
        setGraphData({ nodes, links }); if (parsed.architecture) setArchitecture(parsed.architecture);
        setStats({ nodes: nodes.length, links: links.length, time: ((Date.now() - t0) / 1000).toFixed(1) });
        setThoughts(p => p + `${nodes.length} nodes, ${links.length} links\n`);
        setBottomTab("deps");
        setTimeout(() => fgRef.current?.zoomToFit(1000, 100), 500);
      } else if (fileList) {
        // Full fallback
        const nodes = fileList.map(f => { const fn = f.relative_path.split("/").pop(); const isE = /^(main|app|index|server)\./i.test(fn); return { id: f.relative_path, name: fn, type: isE ? "star" : "planet", group: "auto", language: f.language, color: isE ? "#6366f1" : "#3b82f6", val: isE ? 14 : 8, complexity: f.complexity_score, details: {} }; });
        setGraphData({ nodes, links: [] }); setStats({ nodes: nodes.length, links: 0, time: ((Date.now() - t0) / 1000).toFixed(1) });
      }
    } catch (err) { setError(err.message); setThoughts(p => p + `\nError: ${err.message}\n`); }
    finally { setIsScanning(false); }
  };

  // ─── Query ───
  const sendQuery = async () => {
    if (!queryInput.trim() || !repoPath) return;
    setIsQuerying(true); setQueryAnswer("");
    try {
      const body = { directory_path: repoPath, question: queryInput };
      if (apiKey && !keySaved) body.nvidia_api_key = apiKey;
      await streamSSE(`${API}/query`, body, { onContent: (c) => setQueryAnswer(p => p + c) });
    } catch (e) { setQueryAnswer(`Error: ${e.message}`); }
    finally { setIsQuerying(false); }
  };

  // ─── Feature Scans (Security, Onboarding, CUDA) ───
  const runFeature = async (endpoint, setLoading, setData, setThoughtsState, tabName) => {
    if (!repoPath) return;
    setLoading(true); setData(null); setThoughtsState(""); setLeftTab(tabName);
    try {
      const body = { directory_path: repoPath };
      if (apiKey && !keySaved) body.nvidia_api_key = apiKey;
      const rawJson = await streamSSE(`${API}/${endpoint}`, body, {
        onThought: (t) => setThoughtsState(p => p + t),
        onDone: () => {},
      });
      const parsed = repairAndParseJSON(rawJson);
      if (parsed) setData(parsed);
    } catch (e) { setThoughtsState(p => p + `\nError: ${e.message}`); }
    finally { setLoading(false); }
  };

  const exportJSON = () => { const b = new Blob([JSON.stringify({ ...graphData, architecture, metadata: repoMeta }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "mamba-graph.json"; a.click(); };

  const langBreakdown = useMemo(() => {
    if (!repoMeta?.languages) return [];
    const tot = Object.values(repoMeta.languages).reduce((a, b) => a + b, 0);
    return Object.entries(repoMeta.languages).sort(([,a],[,b]) => b - a).map(([l, n]) => ({ lang: l, lines: n, pct: ((n / tot) * 100).toFixed(1) }));
  }, [repoMeta]);

  const depLinks = repoMeta?.dependency_links || [];
  const hotspots = repoMeta?.hotspots || [];

  const sevColor = (s) => s === "critical" ? "badge-critical" : s === "high" ? "badge-high" : s === "medium" ? "badge-medium" : "badge-low";

  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ background: "var(--bg-primary)", fontFamily: "'Inter', sans-serif" }}>

      {/* ─── HEADER ─── */}
      <header className="panel m-2 mb-0 px-4 py-2.5 flex items-center gap-4 z-50">
        <div className="flex items-center gap-2.5 pr-4 border-r" style={{ borderColor: "var(--border)" }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-dim)" }}>
            <Cpu size={18} style={{ color: "var(--accent-light)" }} />
          </div>
          <div>
            <h1 className="font-black text-sm tracking-tight" style={{ color: "var(--text-primary)" }}>Mamba-Graph</h1>
            <span className="text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>Nemotron Cartography</span>
          </div>
        </div>

        <div className="flex-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }}>
            {isUrl ? <Link2 size={14} /> : <FolderOpen size={14} />}
          </div>
          <input className="mg-input pl-9 pr-3" placeholder="Local path or GitHub URL..." value={repoPath} onChange={e => setRepoPath(e.target.value)} />
          {isUrl && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold px-2 py-0.5 rounded" style={{ background: "var(--accent-dim)", color: "var(--accent-light)" }}>URL</span>}
        </div>

        <div className="w-56">
          {keySaved ? (
            <div className="mg-input flex items-center gap-2 text-xs" style={{ color: "var(--green)" }}>
              <Check size={14} /> API key saved
            </div>
          ) : (
            <div className="relative">
              <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input type="password" className="mg-input pl-9 pr-16" placeholder="NVIDIA API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
              {apiKey && <button onClick={saveKey} className="absolute right-2 top-1/2 -translate-y-1/2 btn-sm btn-primary" style={{ fontSize: 9 }}><Save size={10} /> Save</button>}
            </div>
          )}
        </div>

        <button onClick={runScan} disabled={isScanning} className="btn-primary">
          {isScanning ? <><Activity size={14} className="animate-spin" /> Analyzing...</> : <><Play size={14} fill="white" /> Map Repo</>}
        </button>
        <button onClick={loadDemo} className="btn-outline"><Box size={13} /> Demo</button>
      </header>

      {error && (
        <div className="mx-2 mt-2 px-4 py-2 rounded-lg flex items-center gap-2 text-sm" style={{ background: "var(--red-dim)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError("")} className="ml-auto"><X size={14} /></button>
        </div>
      )}

      {/* ─── MAIN ─── */}
      <div className="flex-1 flex gap-2 p-2 overflow-hidden">

        {/* LEFT PANEL */}
        <aside className="w-[340px] flex flex-col gap-2 overflow-hidden">
          <div className="panel flex flex-wrap">
            {[
              { id: "terminal", icon: Terminal, label: "Trace" },
              { id: "query", icon: MessageSquare, label: "Query" },
              { id: "stats", icon: BarChart3, label: "Stats" },
              { id: "security", icon: Shield, label: "Security" },
              { id: "onboarding", icon: BookOpen, label: "Guide" },
              { id: "cuda", icon: Gauge, label: "GPU" },
            ].map(({ id, icon: Icon, label }) => (
              <button key={id} onClick={() => setLeftTab(id)} className={`tab-btn ${leftTab === id ? "active" : ""}`}>
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>

          <div className="panel flex-1 flex flex-col overflow-hidden">

            {/* TRACE */}
            {leftTab === "terminal" && (
              <>
                <div className="px-4 py-2.5 flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  <Terminal size={13} /> Nemotron Reasoning
                </div>
                <div ref={termRef} className="trace-output flex-1">
                  {thoughts || "Ready. Enter a path or URL and click Map Repo.\n"}<span className="trace-cursor" />
                </div>
              </>
            )}

            {/* QUERY */}
            {leftTab === "query" && (
              <div className="flex flex-col h-full">
                <div className="px-4 py-2.5 flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  <MessageSquare size={13} /> Ask Nemotron
                </div>
                <div ref={queryRef} className="flex-1 px-4 py-3 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                  {queryAnswer || <span style={{ color: "var(--text-muted)" }}>Ask anything about your codebase after scanning.{"\n\n"}Examples:{"\n"}• "What's the most coupled module?"{"\n"}• "Where should I add a new API route?"{"\n"}• "Explain the data flow"</span>}
                </div>
                <div className="p-2 flex gap-2" style={{ borderTop: "1px solid var(--border)" }}>
                  <input className="mg-input flex-1 text-sm" placeholder="Ask a question..." value={queryInput}
                    onChange={e => setQueryInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendQuery()} disabled={!repoPath || isQuerying} />
                  <button onClick={sendQuery} disabled={!repoPath || isQuerying} className="btn-primary btn-sm"><Send size={13} /></button>
                </div>
              </div>
            )}

            {/* STATS */}
            {leftTab === "stats" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {repoMeta ? (<>
                  <h2 className="text-base font-black" style={{ color: "var(--text-primary)" }}>{repoMeta.name}</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ l: "Files", v: repoMeta.total_files }, { l: "Lines", v: repoMeta.total_lines?.toLocaleString() }, { l: "Complexity", v: `${repoMeta.avg_complexity}/100` }, { l: "Languages", v: Object.keys(repoMeta.languages).length }].map(({ l, v }) => (
                      <div key={l} className="card">
                        <div className="text-[10px] font-semibold uppercase mb-1" style={{ color: "var(--text-muted)" }}>{l}</div>
                        <div className="text-lg font-black" style={{ color: "var(--accent-light)" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase mb-2" style={{ color: "var(--text-muted)" }}>Languages</div>
                    {langBreakdown.map(({ lang, pct }) => (
                      <div key={lang} className="mb-2">
                        <div className="flex justify-between text-xs mb-1"><span style={{ color: "var(--text-primary)" }}>{lang}</span><span style={{ color: "var(--text-muted)" }}>{pct}%</span></div>
                        <div className="h-1.5 rounded-full" style={{ background: "var(--bg-hover)" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} /></div>
                      </div>
                    ))}
                  </div>
                  {architecture && (
                    <div className="card space-y-3">
                      <div className="text-sm font-black" style={{ color: "var(--accent-light)" }}>{architecture.pattern}</div>
                      <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{architecture.summary}</p>
                      {architecture.strengths?.length > 0 && <p className="text-xs leading-relaxed"><span style={{ color: "var(--green)" }} className="font-bold">Strengths: </span><span style={{ color: "var(--text-secondary)" }}>{architecture.strengths.join(" · ")}</span></p>}
                      {architecture.concerns?.length > 0 && <p className="text-xs leading-relaxed"><span style={{ color: "var(--orange)" }} className="font-bold">Concerns: </span><span style={{ color: "var(--text-secondary)" }}>{architecture.concerns.join(" · ")}</span></p>}
                      {architecture.suggestions?.length > 0 && <p className="text-xs leading-relaxed"><span style={{ color: "var(--accent-light)" }} className="font-bold">Suggestions: </span><span style={{ color: "var(--text-secondary)" }}>{architecture.suggestions.join(" · ")}</span></p>}
                    </div>
                  )}
                </>) : <p className="text-center py-10 text-sm" style={{ color: "var(--text-muted)" }}>Scan a repo to see stats</p>}
              </div>
            )}

            {/* SECURITY */}
            {leftTab === "security" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--red)" }}><Shield size={16} /> Security Audit</div>
                  <button onClick={() => runFeature("security", setSecurityLoading, setSecurityData, setSecurityThoughts, "security")} disabled={!repoPath || securityLoading} className="btn-primary btn-sm">{securityLoading ? "Scanning..." : "Run Scan"}</button>
                </div>
                {securityLoading && <div className="trace-output text-[11px] max-h-28 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>{securityThoughts}<span className="trace-cursor" /></div>}
                {securityData ? (<>
                  <div className="flex items-center gap-4">
                    <div className="text-4xl font-black" style={{ color: securityData.security_score >= 80 ? "var(--green)" : securityData.security_score >= 50 ? "var(--orange)" : "var(--red)" }}>
                      {securityData.security_score}<span className="text-sm ml-1" style={{ color: "var(--text-muted)" }}>/100</span>
                    </div>
                    <div className="flex-1 h-2 rounded-full" style={{ background: "var(--bg-hover)" }}><div className="h-full rounded-full transition-all" style={{ width: `${securityData.security_score}%`, background: securityData.security_score >= 80 ? "var(--green)" : securityData.security_score >= 50 ? "var(--orange)" : "var(--red)" }} /></div>
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{securityData.summary}</p>
                  {securityData.positive?.length > 0 && <p className="text-xs" style={{ color: "var(--green)" }}><CheckCircle size={12} className="inline mr-1" />{securityData.positive.join(" · ")}</p>}
                  {securityData.vulnerabilities?.map((v, i) => (
                    <div key={i} className="card space-y-1.5" style={{ borderColor: v.severity === "critical" ? "rgba(239,68,68,0.3)" : v.severity === "high" ? "rgba(245,158,11,0.3)" : "var(--border)" }}>
                      <div className="flex items-center gap-2"><span className={`badge ${sevColor(v.severity)}`}>{v.severity}</span><span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{v.vulnerability}</span></div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{v.file} — {v.line_hint}</div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{v.description}</p>
                      <p className="text-xs" style={{ color: "var(--green)" }}>Fix: {v.fix}</p>
                    </div>
                  ))}
                </>) : !securityLoading && <p className="text-center py-10 text-sm" style={{ color: "var(--text-muted)" }}>Click "Run Scan" after mapping a repo</p>}
              </div>
            )}

            {/* ONBOARDING */}
            {leftTab === "onboarding" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--accent-light)" }}><BookOpen size={16} /> Onboarding Guide</div>
                  <button onClick={() => runFeature("onboarding", setOnboardingLoading, setOnboardingData, setOnboardingThoughts, "onboarding")} disabled={!repoPath || onboardingLoading} className="btn-primary btn-sm">{onboardingLoading ? "Generating..." : "Generate"}</button>
                </div>
                {onboardingLoading && <div className="trace-output text-[11px] max-h-28 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>{onboardingThoughts}<span className="trace-cursor" /></div>}
                {onboardingData ? (<>
                  <div><h3 className="text-base font-black" style={{ color: "var(--text-primary)" }}>{onboardingData.project_name}</h3><p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{onboardingData.one_liner}</p></div>
                  {onboardingData.tech_stack && <div className="flex flex-wrap gap-1.5">{onboardingData.tech_stack.map(t => <span key={t} className="badge" style={{ background: "var(--accent-dim)", color: "var(--accent-light)", border: "1px solid rgba(99,102,241,0.2)" }}>{t}</span>)}</div>}
                  {onboardingData.steps?.map((step, i) => (
                    <div key={i} className="card space-y-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: "var(--accent-dim)", color: "var(--accent-light)" }}>{step.order}</span>
                        <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>{step.title}</span>
                      </div>
                      <div className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>{step.file}</div>
                      <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{step.description}</p>
                      {step.key_things?.length > 0 && <div className="flex flex-wrap gap-1">{step.key_things.map((k, j) => <span key={j} className="text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>{k}</span>)}</div>}
                      {step.next_hint && <p className="text-xs italic" style={{ color: "var(--accent-light)" }}>→ {step.next_hint}</p>}
                    </div>
                  ))}
                  {onboardingData.first_task && <div className="card" style={{ borderColor: "rgba(34,197,94,0.2)" }}><div className="text-xs font-bold mb-1" style={{ color: "var(--green)" }}>🚀 Your First Task</div><p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{onboardingData.first_task}</p></div>}
                  {onboardingData.gotchas?.length > 0 && <div className="card" style={{ borderColor: "rgba(245,158,11,0.2)" }}><div className="text-xs font-bold mb-1" style={{ color: "var(--orange)" }}>⚠ Gotchas</div>{onboardingData.gotchas.map((g, i) => <p key={i} className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>• {g}</p>)}</div>}
                </>) : !onboardingLoading && <p className="text-center py-10 text-sm" style={{ color: "var(--text-muted)" }}>Click "Generate" after mapping a repo</p>}
              </div>
            )}

            {/* CUDA/GPU */}
            {leftTab === "cuda" && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--nvidia)" }}><Gauge size={16} /> GPU Performance</div>
                  <button onClick={() => runFeature("cuda", setCudaLoading, setCudaData, setCudaThoughts, "cuda")} disabled={!repoPath || cudaLoading} className="btn-primary btn-sm">{cudaLoading ? "Analyzing..." : "Analyze"}</button>
                </div>
                {cudaLoading && <div className="trace-output text-[11px] max-h-28 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>{cudaThoughts}<span className="trace-cursor" /></div>}
                {cudaData ? (<>
                  <div className="flex items-center gap-4">
                    <div className="text-4xl font-black" style={{ color: cudaData.gpu_score >= 80 ? "var(--green)" : cudaData.gpu_score >= 50 ? "var(--orange)" : "var(--red)" }}>
                      {cudaData.gpu_score}<span className="text-sm ml-1" style={{ color: "var(--text-muted)" }}>/100</span>
                    </div>
                    <div><div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>GPU Score</div><div className="text-xs" style={{ color: "var(--text-muted)" }}>{cudaData.framework || "N/A"} · {cudaData.gpu_usage_detected ? "GPU detected" : "No GPU code"}</div></div>
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{cudaData.summary}</p>
                  {cudaData.findings?.map((f, i) => (
                    <div key={i} className="card space-y-1.5">
                      <div className="flex items-center gap-2"><span className={`badge ${sevColor(f.severity)}`}>{f.severity}</span><span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{f.category}</span></div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{f.file} — {f.location}</div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{f.issue}</p>
                      <p className="text-xs" style={{ color: "var(--orange)" }}>Impact: {f.impact}</p>
                      <p className="text-xs" style={{ color: "var(--green)" }}>Fix: {f.fix}</p>
                      {f.estimated_speedup && <p className="text-xs font-bold" style={{ color: "var(--nvidia)" }}>⚡ {f.estimated_speedup}</p>}
                    </div>
                  ))}
                  {cudaData.optimizations?.map((o, i) => (
                    <div key={i} className="card space-y-1.5" style={{ borderColor: "rgba(34,197,94,0.2)" }}>
                      <div className="flex items-center justify-between"><span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{o.title}</span><div className="flex gap-1"><span className="badge" style={{ background: o.effort === "low" ? "var(--green-dim)" : "var(--orange-dim)", color: o.effort === "low" ? "var(--green)" : "var(--orange)" }}>{o.effort}</span><span className="badge" style={{ background: "var(--green-dim)", color: "var(--green)" }}>{o.impact} impact</span></div></div>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{o.description}</p>
                      {o.code_hint && <code className="block text-[11px] px-3 py-2 rounded font-mono" style={{ background: "var(--bg-primary)", color: "var(--nvidia)" }}>{o.code_hint}</code>}
                    </div>
                  ))}
                </>) : !cudaLoading && <p className="text-center py-10 text-sm" style={{ color: "var(--text-muted)" }}>Click "Analyze" after mapping a repo<br/><span className="text-xs mt-1 block">Best with CUDA / PyTorch / TensorFlow repos</span></p>}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER */}
        <div className="flex-1 flex flex-col gap-2 overflow-hidden">
          <main className="flex-1 panel relative overflow-hidden">
            <ForceGraph3D ref={fgRef} graphData={animatedGraph} backgroundColor="#08080d"
              nodeLabel={n => `<div style="background:#12121a;border:1px solid ${getColor(n)};padding:6px 10px;font-size:11px;color:#e4e4ed;font-family:Inter,sans-serif;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.5)"><b>${n.name}</b><br/><span style="color:#9898ab;font-size:10px">${n.language||n.type} · complexity ${n.complexity||0}</span></div>`}
              nodeThreeObject={nodeObj}
              linkColor={l => l === hoveredLink ? "#6366f1" : "rgba(99,102,241,0.15)"}
              linkWidth={l => l === hoveredLink ? 2.5 : 0.8}
              linkDirectionalParticles={3} linkDirectionalParticleWidth={1.2}
              linkDirectionalParticleSpeed={d => (d.strength || 0.5) * 0.005}
              linkDirectionalParticleColor={() => "#6366f1"}
              linkDirectionalArrowLength={4} linkDirectionalArrowRelPos={0.6} linkDirectionalArrowColor={() => "rgba(99,102,241,0.3)"}
              linkThreeObjectExtend={true}
              linkThreeObject={link => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: createLinkLabel(link.label || link.relationship || ""), transparent: true, opacity: 0, depthWrite: false })); sp.scale.set(28, 4, 1); sp.userData = { link }; return sp; }}
              linkPositionUpdate={(sp, { start, end }) => { sp.position.set(start.x + (end.x - start.x) / 2, start.y + (end.y - start.y) / 2 + 6, start.z + (end.z - start.z) / 2); sp.material.opacity = hoveredLink && sp.userData.link === hoveredLink ? 1 : 0; }}
              onLinkHover={l => setHoveredLink(l)} onNodeClick={flyTo}
              d3AlphaDecay={0.02} d3VelocityDecay={0.3} warmupTicks={80} cooldownTicks={150}
              onEngineReady={() => { fgRef.current?.d3Force("charge")?.strength(-280).distanceMax(450); fgRef.current?.d3Force("link")?.distance(70); fgRef.current?.d3Force("center")?.strength(0.05); }}
            />

            {/* Controls */}
            <div className="absolute top-3 left-3 flex gap-1.5 z-40">
              {[{ m: "type", i: Layers }, { m: "complexity", i: Flame }, { m: "language", i: Globe }].map(({ m, i: I }) => (
                <button key={m} onClick={() => setColorMode(m)} title={`Color: ${m}`}
                  className="p-2 rounded-lg transition-all" style={{ background: colorMode === m ? "var(--accent-dim)" : "rgba(10,10,15,0.7)", border: `1px solid ${colorMode === m ? "rgba(99,102,241,0.4)" : "var(--border)"}`, color: colorMode === m ? "var(--accent-light)" : "var(--text-muted)" }}>
                  <I size={13} />
                </button>
              ))}
              <div className="w-px mx-0.5" style={{ background: "var(--border)" }} />
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
                <input className="rounded-lg pl-7 pr-2 py-2 text-xs outline-none w-36" style={{ background: "rgba(10,10,15,0.8)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <button onClick={exportJSON} disabled={!graphData.nodes.length} className="p-2 rounded-lg" style={{ background: "rgba(10,10,15,0.7)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                <Download size={13} />
              </button>
            </div>

            {/* Legend */}
            <div className="absolute top-3 right-3 rounded-lg p-2 z-40" style={{ background: "rgba(10,10,15,0.8)", border: "1px solid var(--border)" }}>
              {colorMode === "type" && Object.entries(TYPE_COLORS).map(([t, c]) => (
                <div key={t} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span style={{ color: "var(--text-muted)" }}>{t}</span></div>
              ))}
              {colorMode === "complexity" && CX_GRAD.map(({ t, c }) => <div key={t} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span style={{ color: "var(--text-muted)" }}>{t}+</span></div>)}
              {colorMode === "language" && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>By language</div>}
            </div>

            {/* Node Inspector */}
            <AnimatePresence>
              {selectedNode && (
                <motion.div initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 300, opacity: 0 }} transition={{ type: "spring", damping: 25 }}
                  className="absolute right-0 top-0 bottom-0 w-80 z-50 overflow-y-auto" style={{ background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)" }}>
                  <div className="p-5">
                    <div className="flex justify-between items-start mb-5">
                      <div><div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: getColor(selectedNode) }}>{selectedNode.type} · {selectedNode.language}</div><h2 className="text-base font-black" style={{ color: "var(--text-primary)" }}>{selectedNode.name}</h2></div>
                      <button onClick={() => setSelectedNode(null)} style={{ color: "var(--text-muted)" }}><X size={18} /></button>
                    </div>
                    {selectedNode.complexity !== undefined && (
                      <div className="mb-5"><div className="flex justify-between text-xs mb-1"><span style={{ color: "var(--text-muted)" }}>Complexity</span><span style={{ color: getCxColor(selectedNode.complexity) }}>{selectedNode.complexity}/100</span></div><div className="h-2 rounded-full" style={{ background: "var(--bg-hover)" }}><div className="h-full rounded-full" style={{ width: `${selectedNode.complexity}%`, background: getCxColor(selectedNode.complexity) }} /></div></div>
                    )}
                    <div className="space-y-4 text-[13px]">
                      {selectedNode.details?.purpose && <div><div className="text-[10px] uppercase font-bold mb-1" style={{ color: "var(--text-muted)" }}>Purpose</div><p className="leading-relaxed" style={{ color: "var(--text-secondary)" }}>{selectedNode.details.purpose}</p></div>}
                      {selectedNode.details?.pattern && <span className="inline-block px-2.5 py-1 rounded-md text-xs font-semibold" style={{ background: "var(--accent-dim)", color: "var(--accent-light)" }}>{selectedNode.details.pattern}</span>}
                      {selectedNode.details?.classes?.length > 0 && <div><div className="text-[10px] uppercase font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>Classes</div><div className="flex flex-wrap gap-1">{selectedNode.details.classes.map(c => <span key={c} className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)" }}>{c}</span>)}</div></div>}
                      {selectedNode.details?.functions?.length > 0 && <div><div className="text-[10px] uppercase font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>Functions</div>{selectedNode.details.functions.map(f => <div key={f} className="text-xs py-0.5 pl-2 mb-0.5" style={{ color: "var(--text-secondary)", borderLeft: "2px solid var(--border)" }}>{f}()</div>)}</div>}
                      {selectedNode.details?.key_dependencies?.length > 0 && <div><div className="text-[10px] uppercase font-bold mb-1.5" style={{ color: "var(--text-muted)" }}>Dependencies</div><div className="flex flex-wrap gap-1">{selectedNode.details.key_dependencies.map(d => <span key={d} className="text-[11px] px-2 py-0.5 rounded" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>{d}</span>)}</div></div>}
                      {selectedNode.details?.quality_notes && <div><div className="text-[10px] uppercase font-bold mb-1" style={{ color: "var(--text-muted)" }}>Quality</div><p className="text-xs italic" style={{ color: "var(--text-secondary)" }}>{selectedNode.details.quality_notes}</p></div>}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Stats bar */}
            <div className="absolute bottom-3 left-3 rounded-lg px-3 py-2 text-[11px] font-semibold flex gap-5 z-40" style={{ background: "rgba(10,10,15,0.85)", border: "1px solid var(--border)" }}>
              <span><span style={{ color: "var(--text-muted)" }}>Nodes </span><span style={{ color: "var(--accent-light)" }}>{animatedGraph.nodes.length}{animatedGraph.nodes.length < stats.nodes ? `/${stats.nodes}` : ""}</span></span>
              <span><span style={{ color: "var(--text-muted)" }}>Links </span><span style={{ color: "var(--accent-light)" }}>{animatedGraph.links.length}</span></span>
              <span><span style={{ color: "var(--text-muted)" }}>Time </span><span style={{ color: "var(--accent-light)" }}>{stats.time}s</span></span>
            </div>
          </main>

          {/* BOTTOM PANELS */}
          {(depLinks.length > 0 || hotspots.length > 0) && (
            <div className="panel" style={{ height: bottomTab ? 180 : 36 }}>
              <div className="flex" style={{ borderBottom: bottomTab ? "1px solid var(--border)" : "none" }}>
                {[{ id: "deps", icon: GitBranch, label: "Dependencies", c: depLinks.length }, { id: "hotspots", icon: Flame, label: "Hotspots", c: hotspots.length }, { id: "files", icon: FileCode2, label: "Files", c: repoMeta?.total_files || 0 }].map(({ id, icon: Icon, label, c }) => (
                  <button key={id} onClick={() => setBottomTab(bottomTab === id ? null : id)}
                    className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold transition-all" style={{ color: bottomTab === id ? "var(--accent-light)" : "var(--text-muted)", background: bottomTab === id ? "var(--accent-dim)" : "transparent" }}>
                    <Icon size={11} /> {label} <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{c}</span>
                    {bottomTab === id ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                  </button>
                ))}
              </div>
              {bottomTab && (
                <div className="overflow-auto" style={{ height: 144 }}>
                  {bottomTab === "deps" && (
                    <table className="w-full text-xs">
                      <thead><tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}><th className="text-left px-4 py-2 font-semibold">Source</th><th className="px-2">→</th><th className="text-left px-4 py-2 font-semibold">Target</th><th className="text-left px-4 py-2 font-semibold">Type</th></tr></thead>
                      <tbody>{depLinks.map((l, i) => <tr key={i} className="transition-colors" style={{ borderBottom: "1px solid var(--border)" }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}><td className="px-4 py-1.5 font-mono" style={{ color: "var(--accent-light)" }}>{l.source}</td><td className="px-2" style={{ color: "var(--text-muted)" }}><ArrowRight size={11} /></td><td className="px-4 py-1.5 font-mono" style={{ color: "#60a5fa" }}>{l.target}</td><td className="px-4 py-1.5" style={{ color: "var(--text-muted)" }}>{l.type}</td></tr>)}</tbody>
                    </table>
                  )}
                  {bottomTab === "hotspots" && (
                    <table className="w-full text-xs">
                      <thead><tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}><th className="text-left px-4 py-2 font-semibold">File</th><th className="text-left px-4 py-2 font-semibold">Language</th><th className="text-left px-4 py-2 font-semibold">Lines</th><th className="text-left px-4 py-2 font-semibold">Complexity</th></tr></thead>
                      <tbody>{hotspots.map((h, i) => <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}><td className="px-4 py-1.5 font-mono" style={{ color: "var(--orange)" }}>{h.file}</td><td className="px-4 py-1.5" style={{ color: "var(--text-secondary)" }}>{h.language}</td><td className="px-4 py-1.5" style={{ color: "var(--text-secondary)" }}>{h.lines}</td><td className="px-4 py-1.5"><div className="flex items-center gap-2"><div className="w-14 h-1.5 rounded-full" style={{ background: "var(--bg-hover)" }}><div className="h-full rounded-full" style={{ width: `${h.complexity}%`, background: getCxColor(h.complexity) }} /></div><span style={{ color: getCxColor(h.complexity) }}>{h.complexity}</span></div></td></tr>)}</tbody>
                    </table>
                  )}
                  {bottomTab === "files" && (
                    <table className="w-full text-xs">
                      <thead><tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}><th className="text-left px-4 py-2 font-semibold">File</th><th className="text-left px-4 py-2 font-semibold">Connections</th></tr></thead>
                      <tbody>{(repoMeta?.most_connected || []).map((f, i) => <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}><td className="px-4 py-1.5 font-mono" style={{ color: "var(--accent-light)" }}>{f.file}</td><td className="px-4 py-1.5" style={{ color: "#60a5fa" }}>{f.connections}</td></tr>)}</tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}