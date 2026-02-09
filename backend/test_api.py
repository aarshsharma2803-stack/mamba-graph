import requests
import json
import os
import sys

API_BASE_URL = "http://localhost:8000"
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
TEST_DIRECTORY = os.getenv("TEST_DIRECTORY", "./test-project")


def test_health():
    print("─── Health Check ───")
    r = requests.get(f"{API_BASE_URL}/")
    data = r.json()
    print(f"  Status: {data['status']}")
    print(f"  Engine: {data['engine']}")
    print(f"  Features: {', '.join(data['features'])}")
    print()
    return r.status_code == 200


def test_preview():
    print("─── File Preview ───")
    payload = {
        "directory_path": TEST_DIRECTORY,
        "nvidia_api_key": NVIDIA_API_KEY,
        "max_files": 50,
        "include_tests": False,
    }
    r = requests.post(f"{API_BASE_URL}/api/v1/preview", json=payload)
    if r.status_code == 200:
        data = r.json()
        summary = data["summary"]
        print(f"  Repo: {summary['name']}")
        print(f"  Files: {summary['total_files']} | Lines: {summary['total_lines']}")
        print(f"  Languages: {json.dumps(summary['languages'], indent=4)}")
        print(f"  Avg Complexity: {summary['avg_complexity']}/100")
        print(f"  Dependencies found: {len(summary['dependency_links'])}")
        print()
        for f in data["files"][:8]:
            print(f"    {f['relative_path']:40s} {f['language']:15s} {f['line_count']:>5} lines  complexity={f['complexity_score']}")
        if len(data["files"]) > 8:
            print(f"    ... and {len(data['files']) - 8} more")
    else:
        print(f"  ERROR {r.status_code}: {r.text}")
    print()


def test_analyze_sse():
    print("─── SSE Analysis Stream ───")
    payload = {
        "directory_path": TEST_DIRECTORY,
        "nvidia_api_key": NVIDIA_API_KEY,
        "max_files": 30,
    }
    print(f"  Analyzing: {TEST_DIRECTORY}")
    print("  Streaming SSE events...\n")

    try:
        with requests.post(f"{API_BASE_URL}/api/v1/analyze", json=payload, stream=True, timeout=180) as r:
            if r.status_code != 200:
                print(f"  ERROR: {r.status_code}")
                return

            json_buffer = ""
            thought_chars = 0
            metadata = None

            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                if event["type"] == "metadata":
                    metadata = event["content"]
                    print(f"  📊 Metadata received: {metadata['total_files']} files, {metadata['total_lines']} lines")
                elif event["type"] == "thought":
                    thought_chars += len(event["content"])
                    sys.stdout.write(".")
                    sys.stdout.flush()
                elif event["type"] == "content":
                    json_buffer += event["content"]
                elif event["type"] == "done":
                    print(f"\n  ✅ Stream complete. Reasoning: {thought_chars} chars")
                elif event["type"] == "error":
                    print(f"\n  ❌ Error: {event['content']}")
                    return

            # Parse the JSON graph
            start = json_buffer.find("{")
            end = json_buffer.rfind("}")
            if start != -1 and end != -1:
                graph = json.loads(json_buffer[start : end + 1])
                print(f"  Nodes: {len(graph.get('nodes', []))}")
                print(f"  Links: {len(graph.get('links', []))}")
                if "architecture" in graph:
                    arch = graph["architecture"]
                    print(f"  Pattern: {arch.get('pattern', 'N/A')}")
                    print(f"  Summary: {arch.get('summary', 'N/A')}")

                with open("graph_output.json", "w") as f:
                    json.dump(graph, f, indent=2)
                print("  📁 Saved to graph_output.json")
            else:
                print("  ⚠️  Could not extract JSON from response")

    except requests.exceptions.Timeout:
        print("  ⏱️  Timeout — try reducing max_files")
    except Exception as e:
        print(f"  Error: {e}")
    print()


def test_mermaid_export():
    print("─── Mermaid Export ───")
    payload = {
        "directory_path": TEST_DIRECTORY,
        "nvidia_api_key": NVIDIA_API_KEY,
        "max_files": 50,
    }
    r = requests.post(f"{API_BASE_URL}/api/v1/export/mermaid", json=payload)
    if r.status_code == 200:
        data = r.json()
        lines = data["mermaid"].split("\n")
        print(f"  Generated {len(lines)} lines of Mermaid")
        for line in lines[:10]:
            print(f"    {line}")
        if len(lines) > 10:
            print(f"    ... ({len(lines) - 10} more lines)")
    else:
        print(f"  ERROR: {r.status_code}: {r.text}")
    print()


def main():
    print("=" * 60)
    print("  MAMBA-GRAPH API TEST SUITE v3.0")
    print("=" * 60)
    print()

    # Preflight
    try:
        if not test_health():
            return
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect. Run: python main.py")
        return

    if not NVIDIA_API_KEY:
        print("⚠️  Set NVIDIA_API_KEY env variable for full tests")
        print()

    if not os.path.exists(TEST_DIRECTORY):
        print(f"⚠️  Test directory '{TEST_DIRECTORY}' not found")
        print("  Set TEST_DIRECTORY env variable or create the directory")
        return

    test_preview()
    test_mermaid_export()

    if NVIDIA_API_KEY:
        confirm = input("Run full Nemotron analysis? (uses API credits) [y/N]: ")
        if confirm.lower() == "y":
            test_analyze_sse()
    else:
        print("Skipping Nemotron analysis (no API key)")


if __name__ == "__main__":
    main()
