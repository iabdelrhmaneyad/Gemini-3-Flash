"""
RAG-BASED VIDEO ANALYSIS TOOL
=============================

This script uses a "Chat-based Retrieval" approach to strictly enforce Quality Guidelines.
Instead of a single prompt, it establishes a "Knowledge Base" from the provided PDFs and then
analyzes the session by cross-referencing every observation against these rules.

WORKFLOW:
1. Extract Resources (Audio/Frames) - Optimized
2. Upload Resources (Parallel)
3. Initialize Chat Session
4. Step 1: Ingest Rules (Send PDFs)
5. Step 2: Ingest Session Data (Send Frames + Transcript)
6. Step 3: Perform "Chain-of-Thought" Analysis
7. Generate Report
"""

import os
from google import genai
from google.genai import types
import json
import argparse
import time
import subprocess
import shutil
import glob
import random
import re
import concurrent.futures

# ============================================================================
# CONFIGURATION
# ============================================================================
# Prefer env var for safety; fallback keeps existing behavior.
API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyAWg-0-zCBT9Aj6-jIU-W4SWCTQ3D2UKMA")

BASE_DIR = "/home/ai_quality/Desktop/TestVideo 22122025"

# File Paths
VIDEO_FILE_PATH = os.path.join(BASE_DIR, "Sessions/T-4053/T-4053_Jan_5_2026_Slot 5.mp4")
TRANSCRIPT_PATH = os.path.join(BASE_DIR, "Sessions/T-4053/T-4053_Jan_5_2026_Slot 5.txt")
PDF_REFERENCE_FILES = [
    os.path.join(BASE_DIR, "Quality Guide for Reviewers.pdf"),
    os.path.join(BASE_DIR, "Quality Comments V1062025.pdf"),
    os.path.join(BASE_DIR, "Examples of Flag comments.pdf")
]

# Output
OUTPUT_REPORT_TXT = os.path.join(BASE_DIR, "Sessions/T-4053/Quality_Report_RAG_T-4053.txt")

# Video Processing
# Video Processing (Optimized for Quality)
DEFAULT_START_TIME = "00:15:00"
FRAME_EXTRACTION_INTERVAL = 60   # Extract 1 frame every 60 seconds (Higher density)
FRAME_WIDTH = 1024               # Reduced from 1280 to save tokens (still readable)
FRAME_QUALITY = 2                # -q:v 2 (Near lossless)
TARGET_FRAME_COUNT = 35          # Analyze more frames for better coverage

MODEL_NAME = "gemini-2.5-flash"

MODEL_TEMPERATURE = 0.0   # Strict adherence
MODEL_TOP_P = 1.0         # Extremely focused for determinism
MODEL_TOP_K = 1           # Greedy decoding for consistency
# candidate_count: 1 is implicitly 1 for most SDK methods, but we enforce it in config

# Gemini 2.5 latency/cost control:
# 2.5 models have thinking enabled by default (dynamic). Setting thinking_budget=0 disables it for 2.5 Flash.
# Docs: https://ai.google.dev/gemini-api/docs/troubleshooting#high-latency-or-token-usage
DEFAULT_THINKING_BUDGET = 0

# Reproducibility controls
DEFAULT_SEED = 42

# Policy toggles
DEFAULT_IGNORE_CAMERA_QUALITY = True

# Output control (leave unset by default; can be overridden via CLI)
# When unset, we do NOT send max_output_tokens in the API request.
DEFAULT_MAX_OUTPUT_TOKENS = None

# Retry control for API failures / JSON parse errors
MAX_JSON_RETRIES = 3

# Costs (Gemini 2.5 Flash)
COST_PER_MILLION_INPUT_TOKENS = 0.30
COST_PER_MILLION_OUTPUT_TOKENS = 2.50

# Temp Files
TEMP_AUDIO_FILENAME = "temp_audio.mp3"
TEMP_FRAMES_DIRNAME = "frames"

# ============================================================================
# CORE FUNCTIONS
# ============================================================================

# Initialize the new google.genai client
client = genai.Client(api_key=API_KEY)

def _resolve_ffmpeg_exe():
    """Return path to ffmpeg binary, preferring system ffmpeg then imageio-ffmpeg."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        return None
    return None


def _resolve_ffprobe_exe(ffmpeg_exe=None):
    """Return path to ffprobe binary if available."""
    exe = shutil.which("ffprobe")
    if exe:
        return exe
    if ffmpeg_exe:
        candidate = os.path.join(os.path.dirname(ffmpeg_exe), "ffprobe")
        if os.path.exists(candidate):
            return candidate
    return None

def upload_to_gemini(path, mime_type=None, index=None, total=None):
    """Uploads the given file to Gemini sequentially with progress tracking."""
    if index is not None and total is not None:
        prefix = f"Counter: [{index}/{total}]"
    else:
        prefix = "Uploading"
    
    try:
        file = client.files.upload(file=path, config={"mime_type": mime_type} if mime_type else None)
        print(f"{prefix} [OK] {file.uri}")
        return (file, path)  # Return tuple for sorting by original path
    except Exception as e:
        print(f"{prefix} [FAIL] Failed to upload {path}: {e}")
        raise

def upload_files_sequentially(files_to_upload):
    """Uploads multiple files sequentially (One after another)."""
    uploaded_files = []
    total_files = len(files_to_upload)
    print(f"Starting sequential upload for {total_files} files...")
    
    for i, (path, mime_type) in enumerate(files_to_upload, 1):
        try:
            file = upload_to_gemini(path, mime_type, index=i, total=total_files)
            uploaded_files.append(file)
        except Exception as e:
            # Error is already printed in upload_to_gemini
            pass
                
    return uploaded_files

def upload_files_parallel(files_to_upload):
    """Uploads multiple files in parallel using ThreadPoolExecutor."""
    uploaded_files = []
    total_files = len(files_to_upload)
    print(f"Starting parallel upload for {total_files} files...")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        future_to_file = {
            executor.submit(upload_to_gemini, path, mime_type, index=i+1, total=total_files): (path, mime_type)
            for i, (path, mime_type) in enumerate(files_to_upload)
        }
        
        for future in concurrent.futures.as_completed(future_to_file):
            try:
                file = future.result()
                uploaded_files.append(file)
            except Exception as e:
                print(f"Upload failed: {e}")
                
    return uploaded_files

def wait_for_files_active(files):
    """Waits for files to be active. Expects (file, path) tuples."""
    print("Waiting for file processing...")
    for f, _ in files:
        file = client.files.get(name=f.name)
        while file.state.name == "PROCESSING":
            print(".", end="", flush=True)
            time.sleep(2)
            file = client.files.get(name=f.name)
        if file.state.name != "ACTIVE":
            raise Exception(f"File {file.name} failed to process")
    print("...all files ready")

def get_start_time_from_transcript(transcript_path):
    """Parses transcript for first timestamp."""
    print(f"Parsing transcript for start time: {transcript_path}")
    try:
        with open(transcript_path, 'r', encoding='utf-8') as f:
            content = f.read()
            match = re.search(r'\[(\d{2}:\d{2}:\d{2})\]', content)
            if match:
                start_time = match.group(1)
                print(f"Found start time: {start_time}")
                return start_time
    except Exception as e:
        print(f"Error parsing transcript: {e}")
    return DEFAULT_START_TIME

def get_video_duration(video_path):
    """Gets video duration in seconds using ffprobe."""
    try:
        ffmpeg_exe = _resolve_ffmpeg_exe()
        ffprobe_exe = _resolve_ffprobe_exe(ffmpeg_exe=ffmpeg_exe)

        if ffprobe_exe:
            cmd = [
                ffprobe_exe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            return float(result.stdout.strip())

        # Fallback: parse ffmpeg -i output (works when ffprobe is unavailable).
        if not ffmpeg_exe:
            return 0

        cmd = [ffmpeg_exe, "-i", video_path]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        combined = (result.stdout or "") + "\n" + (result.stderr or "")
        match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)", combined)
        if not match:
            return 0
        h = int(match.group(1))
        m = int(match.group(2))
        s = float(match.group(3))
        return h * 3600 + m * 60 + s
    except Exception as e:
        print(f"Error getting duration: {e}")
        return 0

def time_str_to_seconds(time_str):
    """Converts HH:MM:SS to seconds."""
    try:
        h, m, s = map(int, time_str.split(':'))
        return h * 3600 + m * 60 + s
    except ValueError:
        return 0

def extract_frame_at_time(video_path, time_sec, output_path):
    """Extracts a single frame at a specific time."""
    ffmpeg_exe = _resolve_ffmpeg_exe()
    if not ffmpeg_exe:
        print("[WARNING] ffmpeg not found. Skipping frame extraction.")
        return
    cmd = [
        ffmpeg_exe,
        "-ss", str(time_sec),
        "-i", video_path,
        "-frames:v", "1",
        "-q:v", str(FRAME_QUALITY),
        "-vf", f"scale={FRAME_WIDTH}:-1",
        "-y",
        output_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def extract_audio(video_path, output_path):
    """Extracts audio from video."""
    print(f"Extracting audio to {output_path}...")
    ffmpeg_exe = _resolve_ffmpeg_exe()
    if not ffmpeg_exe:
        print(f"[WARNING] ffmpeg not found. Skipping audio extraction.")
        return None
    cmd = [
        ffmpeg_exe,
        "-i", video_path,
        "-vn",
        "-acodec", "libmp3lame",
        "-q:a", "2",
        "-y",
        output_path
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return output_path
    except subprocess.CalledProcessError as e:
        print(f"[WARNING] Audio extraction failed: {e}")
        return None

def extract_resources(video_path, start_time):
    """Extracts frames using parallel ffmpeg seeking (Super Fast)."""
    print("--- Extracting Resources (Super Fast Parallel) ---")
    
    base_dir = os.path.dirname(video_path)
    frames_dir = os.path.join(base_dir, TEMP_FRAMES_DIRNAME)
    
    # Check if frames already exist
    if os.path.exists(frames_dir):
        existing_frames = glob.glob(os.path.join(frames_dir, "*.jpg"))
        if len(existing_frames) >= TARGET_FRAME_COUNT:
            print(f"Frames already exist in {frames_dir}. Skipping extraction.")
            return frames_dir
        else:
            print("Found partial frames, re-extracting...")
            shutil.rmtree(frames_dir)
            
    os.makedirs(frames_dir)
    
    start_seconds = time_str_to_seconds(start_time)
    duration = get_video_duration(video_path)
    
    if duration == 0:
        print("Could not determine duration, using default range...")
        duration = start_seconds + 3600 # Default to 1 hour if unknown

    print(f"Video Duration: {duration:.2f}s, Start Time: {start_seconds}s")
    
    timestamps = []
    current_time = start_seconds
    while current_time < duration:
        timestamps.append(current_time)
        current_time += FRAME_EXTRACTION_INTERVAL
        
    print(f"Extracting {len(timestamps)} frames in parallel...")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        futures = []
        for i, ts in enumerate(timestamps):
            output_path = os.path.join(frames_dir, f"frame_{i:03d}.jpg")
            futures.append(executor.submit(extract_frame_at_time, video_path, ts, output_path))
            
        # Wait for all to complete
        concurrent.futures.wait(futures)
            
    return frames_dir

def generate_html_report_from_json(json_path):
    """Generates a premium, fixed-style professional HTML report from JSON data."""
    html_path = os.path.splitext(json_path)[0] + ".html"
    print(f"\n--- Generating Premium HTML Report: {html_path} ---")
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract data from JSON
        final_score = data.get('scoring', {}).get('final_weighted_score', 0)
        cat_avg = data.get('scoring', {}).get('averages', {})
        cat_scores = {
            'Setup': cat_avg.get('setup', 0),
            'Attitude': cat_avg.get('attitude', 0),
            'Preparation': cat_avg.get('preparation', 0),
            'Curriculum': cat_avg.get('curriculum', 0),
            'Teaching': cat_avg.get('teaching', 0)
        }

        # Score-based styling
        score_color = "#10b981" if final_score >= 90 else "#f59e0b" if final_score >= 70 else "#ef4444"
        perf_label = "EXCELLENT" if final_score >= 90 else "GOOD" if final_score >= 70 else "NEEDS IMPROVEMENT"
        
        # Progress circle math
        dash_offset = 283 - (final_score / 100 * 283)

        # Helper to render lists
        def render_feedback(items, css_class):
            html = ""
            for item in items:
                cat = item.get('category', '?')
                sub = item.get('subcategory', 'General')
                text = item.get('text', '')
                time = item.get('timestamp', '')
                html += f'<div class="feedback-box {css_class}"><strong>{cat} - {sub}:</strong> {text} <small>({time})</small></div>'
            return html

        def render_flags(items):
            html = ""
            for item in items:
                level = item.get('level', 'Yellow')
                # Determine class based on level
                css_class = "f-box-red" if "Red" in level else "f-box-yellow"
                sub = item.get('subcategory', '')
                reason = item.get('reason', '')
                time = item.get('timestamp', '')
                html += f'<div class="feedback-box {css_class}">🚩 <strong>{level} Flag: {sub}</strong> - {reason} <small>({time})</small></div>'
            return html

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>iSchool | Quality Audit Report</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --primary: #4f46e5;
            --primary-dark: #3730a3;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text-main: #1f2937;
            --text-muted: #6b7280;
            --bg-body: #f9fafb;
            --bg-card: #ffffff;
            --score-color: {score_color};
        }}

        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ 
            font-family: 'Outfit', sans-serif; 
            background-color: var(--bg-body); 
            color: var(--text-main); 
            line-height: 1.6;
            overflow-x: hidden;
        }}

        /* Dynamic Background */
        body::before {{
            content: '';
            position: fixed;
            top: 0; left: 0; width: 100%; height: 350px;
            background: linear-gradient(135deg, var(--primary-dark) 0%, #7c3aed 100%);
            z-index: -1;
            clip-path: polygon(0 0, 100% 0, 100% 80%, 0 100%);
        }}

        .wrapper {{ max-width: 1100px; margin: 40px auto; padding: 0 20px; }}

        /* Glassmorphic Header */
        header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 30px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }}

        .logo-box img {{ height: 100px; filter: brightness(0) invert(1); }}
        .header-info h1 {{ font-size: 1.8rem; font-weight: 700; letter-spacing: -0.5px; }}
        .header-info p {{ opacity: 0.8; font-weight: 300; }}

        /* Main Dashboard Layout */
        .dashboard-grid {{
            display: block;
            margin-bottom: 30px;
        }}

        .card {{
            background: var(--bg-card);
            border-radius: 24px;
            padding: 30px;
            box-shadow: 0 4px 25px rgba(0,0,0,0.05);
            border: 1px solid #f1f5f9;
        }}

        /* Score Card Styling */
        .score-card {{ 
            display: flex; 
            flex-direction: row; 
            align-items: center; 
            justify-content: space-around; 
            margin-bottom: 30px;
        }}
        .score-circle {{ position: relative; width: 180px; height: 180px; margin-bottom: 0; }}
        .score-circle svg {{ transform: rotate(-90deg); width: 100%; height: 100%; }}
        .score-circle .bg {{ fill: none; stroke: #f1f5f9; stroke-width: 8; }}
        .score-circle .progress {{ fill: none; stroke: var(--score-color); stroke-width: 10; stroke-linecap: round; transition: 1s ease-out; }}
        .score-val {{ position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; font-weight: 800; color: var(--score-color); }}
        .perf-badge {{ padding: 8px 20px; border-radius: 50px; background: var(--score-color); color: white; font-weight: 700; font-size: 0.8rem; letter-spacing: 1px; margin-top: 10px; }}
        
        .score-left-pane {{ display: flex; flex-direction: column; align-items: center; }}

        /* Category Breakdown */
        .cat-list {{ width: 50%; margin-top: 0; }}
        .cat-item {{ margin-bottom: 18px; }}
        .cat-head {{ display: flex; justify-content: space-between; margin-bottom: 6px; font-weight: 600; font-size: 0.85rem; color: var(--text-muted); }}
        .bar-bg {{ height: 8px; background: #f1f5f9; border-radius: 10px; overflow: hidden; }}
        .bar-fill {{ height: 100%; background: linear-gradient(90deg, var(--primary) 0%, #9333ea 100%); border-radius: 10px; }}

        /* Report Content Styling */
        .report-section {{ background: white; border-radius: 24px; padding: 40px; box-shadow: 0 4px 25px rgba(0,0,0,0.05); border: 1px solid #f1f5f9; }}
        .report-content {{ font-size: 1.05rem; color: var(--text-main); }}
        
        h2 {{ color: var(--primary); font-size: 1.4rem; margin: 35px 0 20px; display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #f1f5f9; padding-bottom: 12px; }}
        h2:first-child {{ margin-top: 0; }}
        
        .feedback-box {{ padding: 18px 22px; border-radius: 16px; margin-bottom: 15px; border-left: 6px solid; transition: transform 0.2s; }}
        .feedback-box:hover {{ transform: translateX(5px); }}
        .p-box {{ background: #f0fdf4; border-color: var(--success); color: #065f46; }}
        .i-box {{ background: #fffbeb; border-color: var(--warning); color: #92400e; }}
        
        /* Flag Colors */
        .f-box-yellow {{ background: #FEFCE8; border-color: #EAB308; color: #713F12; font-weight: 600; }}
        .f-box-red {{ background: #FEF2F2; border-color: #EF4444; color: #B91C1C; font-weight: 600; }}

        /* Professional Tables */
        .table-container {{ overflow-x: auto; margin: 25px 0; border-radius: 16px; border: 1px solid #f1f5f9; }}
        table {{ width: 100%; border-collapse: collapse; text-align: left; }}
        th {{ background: #f8fafc; padding: 16px 20px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 1px; border-bottom: 2px solid #f1f5f9; }}
        td {{ padding: 16px 20px; border-bottom: 1px solid #f1f5f9; font-size: 0.95rem; }}
        tr:last-child td {{ border-bottom: none; }}
        
        pre {{ white-space: pre-wrap; font-family: 'Outfit', sans-serif; }}

        @media (max-width: 900px) {{
            .dashboard-grid {{ display: block; }}
            .score-card {{ flex-direction: column; }}
            .cat-list {{ width: 100%; margin-top: 20px; }}
            header {{ flex-direction: column; text-align: center; gap: 20px; }}
        }}
    </style>
</head>
<body>
    <div class="wrapper">
        <header>
            <div class="logo-box">
                <img src="https://www.webit.network/img/portfolio/ischool/logo.png" alt="iSchool">
            </div>
            <div class="header-info">
                <h1>QUALITY AUDIT REPORT</h1>
                <p>Forensic Session Analysis Dashboard</p>
            </div>
        </header>

        <div class="dashboard-grid">
            <aside class="card score-card">
                <div class="score-left-pane">
                    <div class="score-circle">
                        <svg viewBox="0 0 100 100">
                            <circle class="bg" cx="50" cy="50" r="45"></circle>
                            <circle class="progress" cx="50" cy="50" r="45" style="stroke-dasharray: 283; stroke-dashoffset: {dash_offset};"></circle>
                        </svg>
                        <div class="score-val">{final_score:.0f}</div>
                    </div>
                    <div class="perf-badge">{perf_label}</div>
                </div>
                
                <div class="cat-list">
                    <div class="cat-item">
                        <div class="cat-head"><span>Setup</span><span>{cat_scores['Setup']}/5</span></div>
                        <div class="bar-bg"><div class="bar-fill" style="width: {cat_scores['Setup']/5*100}%"></div></div>
                    </div>
                    <div class="cat-item">
                        <div class="cat-head"><span>Attitude</span><span>{cat_scores['Attitude']}/5</span></div>
                        <div class="bar-bg"><div class="bar-fill" style="width: {cat_scores['Attitude']/5*100}%"></div></div>
                    </div>
                    <div class="cat-item">
                        <div class="cat-head"><span>Preparation</span><span>{cat_scores['Preparation']}/5</span></div>
                        <div class="bar-bg"><div class="bar-fill" style="width: {cat_scores['Preparation']/5*100}%"></div></div>
                    </div>
                    <div class="cat-item">
                        <div class="cat-head"><span>Curriculum</span><span>{cat_scores['Curriculum']}/5</span></div>
                        <div class="bar-bg"><div class="bar-fill" style="width: {cat_scores['Curriculum']/5*100}%"></div></div>
                    </div>
                    <div class="cat-item">
                        <div class="cat-head"><span>Teaching</span><span>{cat_scores['Teaching']}/5</span></div>
                        <div class="bar-bg"><div class="bar-fill" style="width: {cat_scores['Teaching']/5*100}%"></div></div>
                    </div>
                </div>
            </aside>

            <main class="report-section">
                <div class="report-content">
                    <h2>📋 Session Information</h2>
                    <div class="feedback-box p-box">
                        <strong>Tutor:</strong> {data.get('meta', {}).get('tutor_id', 'N/A')}<br>
                        <strong>Date:</strong> {data.get('meta', {}).get('session_date', 'N/A')}<br>
                        <strong>Summary:</strong> {data.get('meta', {}).get('session_summary', 'N/A')}
                    </div>

                    <h2> Audit Summary</h2>
                    <p>{data.get('meta', {}).get('session_summary', 'Analysis completed successfully.')}</p>

                    <h2>✅ Positive Highlights</h2>
                    {render_feedback(data.get('positive_feedback', []), 'p-box')}

                    <h2>⚠️ Improvement Points</h2>
                    {render_feedback(data.get('areas_for_improvement', []), 'i-box')}

                    <h2>🚩 Compliance Violations</h2>
                    {render_flags(data.get('flags', []))}

                    <h2>🎯 Recommended Actions</h2>
                    <ul>
                        {"".join([f"<li>{x}</li>" for x in data.get('action_plan', [])])}
                    </ul>
                </div>
            </main>
        </div>
    </div>
</body>
</html>"""
        
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        print(f"[SUCCESS] Premium Dashboard HTML Report created: {html_path}")
    except Exception as e:
        print(f"Error creating HTML from JSON: {e}")
        import traceback
        traceback.print_exc()

# ============================================================================
# RAG ANALYSIS LOGIC
# ============================================================================

def perform_rag_analysis(video_path, output_report_path, transcript_path=None):
    frames_dir = None
    try:
        # Best-effort determinism (does not guarantee identical outputs across runs)
        try:
            random.seed(args.seed)
        except Exception:
            pass

        # 1. SETUP & EXTRACTION
        if transcript_path is None:
            transcript_path = TRANSCRIPT_PATH
        start_time = DEFAULT_START_TIME
        if os.path.exists(transcript_path):
            start_time = get_start_time_from_transcript(transcript_path)
            
        frames_dir = extract_resources(video_path, start_time)

        # Extract Audio (optional; will be None if ffmpeg missing/fails)
        # Store audio next to video files
        base_dir = os.path.dirname(video_path)
        audio_output_path = os.path.join(base_dir, TEMP_AUDIO_FILENAME)
        audio_path = extract_audio(video_path, audio_output_path)

        # 2. UPLOAD EVERYTHING
        print("\n--- Uploading Resources (Sequential) ---")
        files_to_upload = []
        
        if audio_path and os.path.exists(audio_path):
            files_to_upload.append((audio_path, "audio/mp3"))
        
        for pdf in PDF_REFERENCE_FILES:
            if os.path.exists(pdf):
                files_to_upload.append((pdf, "application/pdf"))
        
        if os.path.exists(transcript_path):
            files_to_upload.append((transcript_path, "text/plain"))
            
        all_frames = sorted(glob.glob(os.path.join(frames_dir, "*.jpg")))
        if len(all_frames) > TARGET_FRAME_COUNT:
            step = len(all_frames) // TARGET_FRAME_COUNT
            selected_frames = [all_frames[i * step] for i in range(TARGET_FRAME_COUNT)]
        else:
            selected_frames = all_frames
        
        for frame in selected_frames:
            files_to_upload.append((frame, "image/jpeg"))
            
        uploaded_files = upload_files_parallel(files_to_upload)
        
        # Categorize resources - sort by original path for deterministic order
        # uploaded_files is now a list of (file_object, original_path) tuples
        pdf_objs = sorted([t for t in uploaded_files if "pdf" in t[0].mime_type], key=lambda t: t[1])
        transcript_objs = sorted([t for t in uploaded_files if "text" in t[0].mime_type], key=lambda t: t[1])
        frame_objs = sorted([t for t in uploaded_files if "image" in t[0].mime_type], key=lambda t: t[1])
        audio_objs = sorted([t for t in uploaded_files if "audio" in t[0].mime_type], key=lambda t: t[1])
        
        print(f"Resources: {len(pdf_objs)} PDFs, {len(transcript_objs)} Transcripts, {len(frame_objs)} Frames, {len(audio_objs)} Audio")
        
        # --- STRICT RESOURCE VALIDATION ---
        missing_resources = []
        if len(pdf_objs) < 3:
            missing_resources.append(f"PDFs: Found {len(pdf_objs)}, Expected 3")
        if len(transcript_objs) < 1:
            missing_resources.append(f"Transcript: Found {len(transcript_objs)}, Expected 1")
        if len(frame_objs) < 35:
            missing_resources.append(f"Frames: Found {len(frame_objs)}, Expected >= 35")
        if len(audio_objs) < 1:
            missing_resources.append(f"Audio: Found {len(audio_objs)}, Expected 1")
            
        if missing_resources:
            print("\n[CRITICAL ERROR] Strict Resource Validation Failed:")
            for msg in missing_resources:
                print(f"  - {msg}")
            print("Aborting analysis to prevent low-quality output.")
            return
            
        wait_for_files_active(uploaded_files)

        # 3. INITIALIZE MODEL (Optimized for Gemini 2.5 Flash latency)
        print("\n--- Initializing Knowledge Base Chat ---")
        
        system_instr = """You are the **Lead Quality Auditor** and **Senior Quality Compliance Auditor** for iSchool.
Your task is to conduct a **Forensic Quality Review** of online coding sessions.

**AUTHORITATIVE REFERENCE DOCUMENTS:**
You will receive 3 PDF documents that are the SINGLE SOURCE OF TRUTH for all quality standards:
1. Quality Guide for Reviewers.pdf - Main quality framework
2. Quality Comments V1062025.pdf - Standardized comment templates
3. Examples of Flag comments.pdf - Yellow/Red flag definitions

**NOTE:** Comments Bank PDF has been removed. Minor stylistic issues not covered by the above 3 PDFs should be listed as "Minor Issues" in areas_for_improvement with lower ratings (4-5).

**ALL quality judgments MUST be based ONLY on rules explicitly stated in these 3 PDFs.**
Do NOT apply external standards or personal judgment beyond what is documented.

**CRITICAL ANTI-HALLUCINATION RULE:**
Do NOT report ANY issue unless you have SPECIFIC EVIDENCE:
- For transcript issues: Include an EXACT QUOTE from the transcript
- For visual issues: Reference the SPECIFIC FRAME NUMBER 
- If you cannot cite a specific quote or frame, DO NOT include the issue

**iSchool 1-on-1 Session Roadmap:**
1. **Connection & Validation (10 Mins)**
   - **Personal Greeting:** Since it's just one student, start with a quick catch-up (How was school? Any cool projects?).
   - **Homework Check:** The student shares their screen immediately. Review their homework together. If they made a mistake, don’t just tell them—ask, "Why do you think the code behaved this way?"
   - **Recap:** Ask the student to explain the main concept from the last session in their own words.

2. **The LEARN Phase: Interactive Demo (15–20 Mins)**
   - **Tailored Introduction:** Present the new concept. Since there are no other students, keep it a two-way conversation. Ask questions constantly to keep them engaged.
   - **Live Coding:** You share your screen and code an example.
   - **Student Participation:** Ask the student to dictate the code to you. "I want to create a loop here; what should I type first?" This ensures they are paying attention.

3. **The MAKE Phase: Implementation (30+ Mins)**
   - **The Build:** The student shares their screen and starts the project.
   - **Proactive Coaching:** You are watching their screen the whole time. Don’t wait for them to get frustrated; if you see a typo, give a small hint immediately.
   - **Handling "Stuck" Moments:**
     - **Verbal First:** Use hints like, "Look at the color of the text on line 10, does it look different?"
     - **Zoom Remote Control:** Since it’s a 1-on-1, you can use remote control more effectively to "draw" on their screen or fix a technical glitch. But remember: Always give control back so they are the ones to type the final solution.

4. **Closure & Submission (5 Mins)**
   - **Project Upload:** Help the student take a screenshot of their code and upload it to the iSchool dashboard.
   - **Summary:** Ask the student, "What was the most challenging part today?"

**AUDIT PROTOCOL:**
1. **INGEST RULES:** Analyze the 4 provided Quality Reference PDFs to establish the rule base.
2. **ANALYZE SESSION:** Cross-reference Audio (MP3), Frames (JPG), and Transcript (TXT) against the rules.
3. **STRICT GUIDELINES:**
    - Only report violations that are explicitly defined in the 4 PDFs.
    - Reference the provided Comment Bank PDF for rule citations.
    - Use exact Category keys: S(Setup), A(Attitude), P(Preparation), C(Curriculum), T(Teaching), F(Feedback).
    - Results must be mathematically verified using the weighted formula.
    - **TIMING EXEMPTION:** Do NOT flag "project activities" or "implementation" issues (Teaching/Curriculum) if they occur before **00:40:00** timestamp.

**OUTCOME:** Return ONLY a valid JSON object matching the required schema."""

        # Model configuration with seed for determinism
        # NOTE: Gemini 2.5 Flash supports thinking_budget; 0 disables thinking for lower latency.
        gen_config_kwargs = dict(
            temperature=MODEL_TEMPERATURE,
            top_p=MODEL_TOP_P,
            top_k=MODEL_TOP_K,
            candidate_count=1,
            response_mime_type="application/json",
            system_instruction=system_instr,
            seed=args.seed,
            thinking_config=types.ThinkingConfig(thinking_budget=args.thinking_budget),
        )
        if args.max_output_tokens is not None:
            gen_config_kwargs["max_output_tokens"] = args.max_output_tokens

        generation_config = types.GenerateContentConfig(**gen_config_kwargs)
        
        # 4. STEP 1: INITIAL GENERATION
        print("\n--- Step 1: Generating Initial Analysis JSON ---")
        combined_prompt = """
Analyze the session files provided (Guidelines, Transcript, Frames, Audio).
Generate a comprehensive Quality Audit Report in JSON format.

**CRITICAL: YOU MUST RETURN VALID JSON ONLY**
- Return JSON in COMPACT format (not pretty-printed with indentation)
- Each JSON object must be on a single line
- All strings must be enclosed in double quotes
- All special characters in strings must be properly escaped (\\n for newlines, \\" for quotes)
- REPLACE all actual newline characters within strings with literal \\n escape sequences
- REPLACE all double quotes within string values with \"
- No unescaped newlines or control characters in strings
- No trailing commas in arrays or objects
- Every opening brace must have a closing brace
- Every opening bracket must have a closing bracket

**REMINDER: You have 3 authoritative PDF documents:**
1. Quality Guide for Reviewers.pdf
2. Quality Comments V1062025.pdf  
3. Examples of Flag comments.pdf

**ALL findings MUST reference these 3 PDFs as the source of truth.**

**REQUIRED SCHEMA:**
{
  "meta": {"tutor_id": "str", "group_id": "str", "session_date": "str", "session_summary": "str"},
  "positive_feedback": [{"category": "str", "subcategory": "str", "text": "str", "cite": "str", "timestamp": "str"}],
  "areas_for_improvement": [{"category": "str", "subcategory": "str", "text": "str", "cite": "str", "timestamp": "str"}],
  "flags": [{"level": "Yellow/Red", "subcategory": "str", "reason": "str", "cite": "str", "timestamp": "str"}],
  "scoring": {
    "setup": [{"subcategory": "str", "rating": 0, "reason": "str"}],
    "attitude": [{"subcategory": "str", "rating": 0, "reason": "str"}],
    "preparation": [{"subcategory": "str", "rating": 0, "reason": "str"}],
    "curriculum": [{"subcategory": "str", "rating": 0, "reason": "str"}],
    "teaching": [{"subcategory": "str", "rating": 0, "reason": "str"}],
    "averages": {"setup": 0, "attitude": 0, "preparation": 0, "curriculum": 0, "teaching": 0},
    "final_weighted_score": 0
  },
  "action_plan": ["string", "string", "string"]
}

**RULES:**
- Category Keys: **S** (Setup), **A** (Attitude), **P** (Preparation), **C** (Curriculum), **T** (Teaching), **F** (Feedback).
- Scoring Logic: 5 (Perfect) down to 1 (Critical). Apply weighted formula: (Setup 25%, Attitude 20%, Prep 15%, Curr 15%, Teach 25%).
- Math Verification: Re-calculate category averages and sum them based on weights before outputting the final score.
- **POSITIVE FEEDBACK:** You MUST include at least **3** specific positive observations in the `positive_feedback` array.
- language English or Arabic are allowed but The language and tone must be appropriate for children..
- **START TIME RULE:** Identify when the student joins. Ignore only the empty waiting time before the session starts. Do NOT ignore the first 10 minutes if the session has already started. The greeting/warm-up phase is CRITICAL for the "Attitude" audit.

---

### **PHASE 1: THE AUDIT PROTOCOL (Strict Enforcement)**
Check the session against these specific criteria. If a violation is found, it **MUST** be listed in "areas_for_improvement" or "flags".
Note the exact timestamp from the transcript where the issue occurs.
Note the Arabic is allowed don't mention it in the report unless technical terms are mispronounced.

**IMPORTANT: 1-HOUR SESSION CONTEXT**
This is a 1-hour online tutoring session. Do NOT report the following as issues:
- Brief moments of silence (under 2 min) while student is coding/thinking
- Tutor briefly checking slides or materials (under 30 seconds)
- One or two instances of minor audio lag that don't disrupt flow
- Student asking for clarification or repeating a question
- Tutor taking a moment to think before answering a complex question

**ONLY report actual violations of the 4 PDF guidelines.**
**1. VISUAL COMPLIANCE (Check Frames)**
*   **Camera (IGNORE FOR REPORTING):** Do NOT add any comments, improvements, or flags about camera angle/framing/visibility.
    - Specifically, ignore and do not report **S - Camera Quality** findings.
*   **Screen Sharing (CRITICAL):**
    *   During the "Make/Coding" phase, the **STUDENT'S** screen must be shared.
    
*   **Zoom Tools Usage (MANDATORY CHECK):**
    * If the tutor repeatedly uses verbal directions  more than 3 times like “look above” instead of Zoom annotations (arrow/highlighter), log:
      **C - Tools and Methodology: Inefficient use of Zoom annotation tools**.

**2. AUDITORY COMPLIANCE (Check Transcript + Audio)**
*   **Dead Air (Silence):** Flag if silence exceeds *6 minutes** without tutor engagement or check-in.
*   **Rapport & Warmth:**
    *   Tutor must provide a warm, professional greeting. Simply being "polite" is not sufficient for top scores.
    *   *Violation:* Flag if greeting is rushed, cold, or absent.
*   **Internet & Audio Stability (MANDATORY CHECK):**
    *   Actively listen for lag, delayed responses, repeated “can you hear me?”, audio cuts, or desync.
    *   If connectivity issues affect flow at any point, log:
      **S - Internet Quality: Internet/audio lags disrupted session flow for more than 2 minutes**.

**3. TEACHING QUALITY (MANDATORY DEEP CHECK):**
*   **Teaching Mode Balance:**
    *   Sessions must maintain interactive engagement. Tutor monologues should be minimal.
    *   *Violation:* Flag if the tutor talks continuously for >10 minutes without student participation.
*   **Guided Thinking:**
    *   Tutors must guide students to discover answers through questioning, not direct answers.
    *   *Violation:* Flag if tutor provides direct answers without attempting Socratic method first.

**4. PROCEDURAL COMPLIANCE (Check Transcript + Audio)**
*   **Opening/Closing:** Roadmap explained? Summary provided? Homework assigned?
*   **Tool Language:** If tools appear in Arabic when English is required, log:
      **P - Project software & slides: Tool language not set to English as required**.

**5. PROJECT COMPLETION VS EXPLANATION (MANDATORY CHECK):**
*   **FIRST 50 MINUTES EXEMPTION:** During the first 50 minutes of the session, it is ACCEPTABLE for the tutor to implement examples to demonstrate concepts. This is NOT a violation.
*   **AFTER 50 MINUTES:** Verify if project was fully implemented by student, partially, or only explained verbally.
*   If explained only (after 50 min), log:
    **C - Slides and Project Completion: Project was explained but not implemented by the student during the session**.
*   If tutor implements while student observes (after 50 min), log:
    **T - Project Implementation & Activities: Tutor-led implementation limited hands-on student practice**.
**6. CONCEPT ACCURACY & MISCONCEPTIONS (CRITICAL CHECK):**
*   If the tutor explains a concept incorrectly or in a misleading way, log:
    **C - Knowledge About Subject: Concept explained inaccurately or misleadingly**.
*   **Examples include (but are not limited to):**
    - Incorrect definition of widget roles (e.g., layout vs content widgets)
    - Misuse or misinterpretation of properties (e.g., alignment, shadow, size)
    - Logical inaccuracies (e.g., wrong condition behavior)

### **FINAL COMPLIANCE GATE (REQUIRED)**
Before producing the final JSON output, explicitly ask yourself:
“Did I check Setup, Attitude, Preparation, Curriculum, Teaching, and Feedback?”
If any category has zero findings (positive or negative), re-scan to confirm.
if the find with not storng and clraer evidence, do not include it.

---

### **PHASE 2: JSON GENERATION RULES**

**1. THE "LIST ALL" RULE:**
*   List valid areas for improvement found.
*   Check the transcript for timestamps.
*   if the find with not storng and clraer evidence, do not include it.

**2. FORMATTING RULE:**
*   For the `"text"` field in feedback lists, use this exact format: `[Category Letter] - [Subcategory]: [Brief description] - Evidence: [Specific example with 1-2 timestamps only]`
*   **CRITICAL:** Include ONLY 1-3 representative timestamps per feedback item. DO NOT list 50+ timestamps.
*   If multiple instances occur, summarize like: "The tutor consistently asked guiding questions at 00:58:43 and throughout the session"
*   Keep evidence text concise and readable (max 2-3 sentences per item, up to 600 characters)
*   **Category Keys:** **S** = Setup, **A** = Attitude, **P** = Preparation, **C** = Curriculum, **T** = Teaching, **F** = Feedback.

---

### **PHASE 3: RIGOROUS SCORING LOGIC (Strict Compliance)**
**You must calculate the score based on the findings from Phase 2. Be precise**

**Step A: Determine Sub-Category Ratings (0-5)**
For **EACH** sub-category in the JSON `scoring` object, apply this specific deduction logic:
*   **5 (Perfect/Excellent):** Flawless execution with ZERO issues or deviations from guidelines.
*   **4 (Good):**  deviation detected. **1-4 "Areas for Improvement"** that don't significantly impact session quality.
*   **3 (Fair):** **5-6 "Areas for Improvement"**.
*   **2 (Weak):** **6+  "Areas for Improvement"** OR **Severe pedagogical failure**.
*   **1 (Critical):** Any Red Flag.
*   **0 (Zero):** No show/Total failure.

**Step B: Apply the Weighted Formula**
Calculate the `final_weighted_score` using these exact weights:
- **Setup (25%):** `(Setup Avg ÷ 5) × 100 × 0.25`
- **Attitude (20%):** `(Attitude Avg ÷ 5) × 100 × 0.20`
- **Preparation (15%):** `(Preparation Avg ÷ 5) × 100 × 0.15`
- **Curriculum (15%):** `(Curriculum Avg ÷ 5) × 100 × 0.15`
- **Teaching (25%):** `(Teaching Avg ÷ 5) × 100 × 0.25`

**Step C: MANDATORY MATH VERIFICATION**
You MUST verify your calculation before finalizing the JSON. The score must be accurate and reflect the findings precisely.
1. List category averages. 2. Apply weights. 3. Sum for final score.
"""
        # Build content parts for the request
        content_parts = [combined_prompt]
        
        print("\n--- API Request Payload Construction ---")
        print(f"Adding {len(pdf_objs)} PDFs to context...")
        print(f"Adding {len(transcript_objs)} Transcripts to context...")
        print(f"Adding {len(frame_objs)} Frames to context...")
        print(f"Adding {len(audio_objs)} Audio files to context...")
        
        # Iterate over all categorized lists (each contains (file, path) tuples)
        for obj_tuple in pdf_objs + transcript_objs + frame_objs + audio_objs:
             # obj_tuple[0] is the Gemini File object
             obj = obj_tuple[0]
             content_parts.append(types.Part.from_uri(file_uri=obj.uri, mime_type=obj.mime_type))
        
        # 4. STEP 1: INITIAL GENERATION
        print("\n--- Step 1: Generating Initial Analysis JSON ---")
        
        # Track token usage
        total_in_tokens = 0
        total_out_tokens = 0

        # Run Step 1
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=content_parts,
            config=generation_config
        )
        
        if response.usage_metadata:
            total_in_tokens += response.usage_metadata.prompt_token_count or 0
            total_out_tokens += response.usage_metadata.candidates_token_count or 0
            
        initial_json = response.text.strip() if response.text else ""
        
        # 5. STEP 2: SELF-AUDIT
        print("\n--- Step 2: Performing Self-Audit ---")
        audit_prompt = f"""Review the following Quality Analysis JSON and perform a **Deep Audit**:
1) AREAS FOR IMPROVEMENT: Be exhaustive. Re-check the session resources against the 3 PDFs.
2) Language: Arabic is ALLOWED. Do NOT flag Arabic usage unless a PDF rule explicitly requires otherwise.
3) POSITIVE FEEDBACK: Ensure there are at least 2 distinct positive highlights; if fewer than 3, find more from the session data.
4) Accuracy: Timestamps and evidence must be precise and cited.
5) No redundancy: Ensure all comments are unique (no repeated meaning/text).
6) Group related issues into single comments where appropriate.
7) FLAGS: Verify all Yellow/Red flags are justified with specific evidence from the session.
8) FORMATTING: Keep feedback text CONCISE. Use only 1-2 representative timestamps per item. DO NOT list 50+ timestamps in evidence.
9) Calculations: Re-calculate the weighted score to ensure 100% mathematical accuracy.

Hard constraints:
- Return ONLY valid JSON matching the existing schema. Do not add new top-level keys.
- Do NOT include any camera angle/framing/visibility/camera quality findings.
- Do NOT include generic session feedback items (category F / session feedback).
- Keep all "text" fields concise (max 600 chars per item).
- For repeated behaviors, use: "The tutor consistently [action] at [timestamp] and throughout the session" instead of listing 50+ times.
- Comments from the removed Comments Bank PDF should NOT be included.

Scoring math rules (must be exact):
- scoring.averages for setup, attitude, preparation, curriculum, teaching = mean of rating values in each scoring[category] list (0-5).
- scoring.final_weighted_score = sum((avg/5)*100*weight) with weights: setup 0.25, attitude 0.20, preparation 0.15, curriculum 0.15, teaching 0.25; round to 1 decimal.

**INPUT JSON:**
{initial_json}

**REQUIRED OUTPUT:**
Corrected and finalized JSON ONLY. Valid JSON format.
"""
        # Re-build content parts with audit prompt
        # Use existing resources (content_parts[1:] are the resources)
        audit_content_parts = [audit_prompt] + content_parts[1:]
        
        final_response = client.models.generate_content(
            model=MODEL_NAME,
            contents=audit_content_parts,
            config=generation_config
        )
        
        if final_response.usage_metadata:
            total_in_tokens += final_response.usage_metadata.prompt_token_count or 0
            total_out_tokens += final_response.usage_metadata.candidates_token_count or 0

        final_json_text = final_response.text.strip() if final_response.text else ""

        # Extract JSON from potential markdown blocks with better error handling
        if "```json" in final_json_text:
            final_json_text = final_json_text.split("```json")[1].split("```")[0].strip()
        elif "```" in final_json_text:
            parts = final_json_text.split("```")
            if len(parts) >= 3:
                final_json_text = parts[1].strip()
        
        # Quick validation of JSON before proceeding
        try:
            json.loads(final_json_text)
        except json.JSONDecodeError as e:
            print(f"[ERROR] API returned invalid JSON: {e}")
            print(f"[DEBUG] First 500 chars: {final_json_text[:500]}")
            print(f"[DEBUG] Last 500 chars: {final_json_text[-500:]}")
            raise ValueError(f"API response contained invalid JSON: {e}")


        # --- SCORE RECALCULATION ---
        json_valid = False
        try:
            data = json.loads(final_json_text)
            json_valid = True
            if "scoring" in data:
                scoring = data["scoring"]
                weights = {"setup": 0.25, "attitude": 0.20, "preparation": 0.15, "curriculum": 0.15, "teaching": 0.25}
                total_score = 0
                new_averages = {}
                
                for cat, weight in weights.items():
                    if cat in scoring and isinstance(scoring[cat], list):
                        ratings = [float(x.get("rating", 0)) for x in scoring[cat] if "rating" in x]
                        avg = sum(ratings) / len(ratings) if ratings else 0
                        new_averages[cat] = round(avg, 1)
                        total_score += (avg / 5) * 100 * weight
                
                if "averages" not in scoring: scoring["averages"] = {}
                scoring["averages"].update(new_averages)
                scoring["final_weighted_score"] = round(total_score, 1)
                final_json_text = json.dumps(data, indent=2)
                print(f"[SUCCESS] Score Recalculated: {scoring['final_weighted_score']}")
        except Exception as e:
            print(f"[WARNING] Score recalculation failed: {e}")
            json_valid = False

        # Save Reports (only if JSON is valid)
        json_report_path = os.path.splitext(output_report_path)[0] + ".json"
        if json_valid:
            try:
                json.loads(final_json_text)  # Final validation before saving
                with open(json_report_path, 'w', encoding='utf-8') as f:
                    f.write(final_json_text)
            except Exception as e:
                print(f"[ERROR] Final JSON validation failed: {e}")
                print("[INFO] Skipping JSON and HTML report generation due to invalid JSON structure.")
                json_report_path = None
        else:
            print("[INFO] Skipping JSON and HTML report generation due to invalid JSON structure.")
            json_report_path = None
        
        if json_report_path:
            with open(output_report_path, 'w', encoding='utf-8') as f:
                f.write(final_json_text) # For legacy compatibility during transition

            print(f"[SUCCESS] Structured Reports saved (.json and .txt)")

            # 6. GENERATE HTML
            if json_report_path:
                generate_html_report_from_json(json_report_path)
        else:
            print(f"[WARNING] Skipping reports - JSON generation produced invalid structure")

        # Final Cost Details
        total_cost = (total_in_tokens / 1e6 * COST_PER_MILLION_INPUT_TOKENS) + (total_out_tokens / 1e6 * COST_PER_MILLION_OUTPUT_TOKENS)
        print(f"Analysis complete. Total Tokens: {total_in_tokens + total_out_tokens} | Total Cost: ${total_cost:.4f}")

    except Exception as e:
        print(f"Error in RAG analysis: {e}")
        import traceback
        traceback.print_exc()
        import sys
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=VIDEO_FILE_PATH)
    parser.add_argument("--output_report", default=None)  # Will be derived from input if not provided
    parser.add_argument("--transcript", default=None)  # Will be derived from input if not provided
    parser.add_argument(
        "--thinking_budget",
        type=int,
        default=DEFAULT_THINKING_BUDGET,
        help="Gemini 2.5 thinking budget. 0=off (faster), -1=dynamic (default model behavior).",
    )
    parser.add_argument(
        "--max_output_tokens",
        type=int,
        default=DEFAULT_MAX_OUTPUT_TOKENS,
        help="Optional cap for output tokens (unset by default).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help="Best-effort determinism seed (does not guarantee identical outputs).",
    )
    parser.add_argument(
        "--ignore_camera_quality",
        action="store_true",
        default=DEFAULT_IGNORE_CAMERA_QUALITY,
        help="Ignore S - Camera Quality findings in narrative + scoring (default: on).",
    )
    parser.add_argument(
        "--include_camera_quality",
        action="store_false",
        dest="ignore_camera_quality",
        help="Include Camera Quality findings (do not filter them).",
    )
    args = parser.parse_args()
    
    # Derive output paths from input if not explicitly provided
    input_path = args.input
    if args.output_report is None:
        # Extract session ID and base name from input path
        # e.g., "Sessions/T-4092/T-4092_Jan_6_2026_Slot 5.mp4" -> use session directory
        session_dir = os.path.dirname(input_path)
        base_name = os.path.basename(input_path)
        # Remove extension and replace with standard report name
        session_id = os.path.basename(session_dir)
        args.output_report = os.path.join(session_dir, f"Quality_Report_RAG_{session_id}.txt")
    
    if args.transcript is None:
        # Look for .txt file in same directory as video
        session_dir = os.path.dirname(input_path)
        # Try to find transcript file (usually .txt with similar name)
        for file in os.listdir(session_dir):
            if file.endswith('.txt') and not file.startswith('Quality_Report'):
                args.transcript = os.path.join(session_dir, file)
                break
    
    perform_rag_analysis(args.input, args.output_report, args.transcript)