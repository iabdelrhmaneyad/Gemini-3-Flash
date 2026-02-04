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
API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyAWg-0-zCBT9Aj6-jIU-W4SWCTQ3D2UKMA")

BASE_DIR = "/home/ai_quality/Desktop/TestVideo 22122025"

# File Paths
VIDEO_FILE_PATH = os.path.join(BASE_DIR, "Sessions/T-4053/T-4053_Jan_5_2026_Slot 5.mp4")
TRANSCRIPT_PATH = os.path.join(BASE_DIR, "Sessions/T-4053/T-4053_Jan_5_2026_Slot 5.txt")
PDF_REFERENCE_FILES = [
    os.path.join(BASE_DIR, "Quality Guide for Reviewers.pdf"),
    os.path.join(BASE_DIR, "Quality Comments V1062025.pdf"),
    os.path.join(BASE_DIR, "Examples of Flag comments.pdf"),
    os.path.join(BASE_DIR, "Comments Bank.pdf")
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

MODEL_NAME = "gemini-3-flash-preview"

MODEL_TEMPERATURE = 0.0   # Strict adherence
MODEL_TOP_P = 1.0         # Extremely focused for determinism
MODEL_TOP_K = 1           # Greedy decoding for consistency
# candidate_count: 1 is implicitly 1 for most SDK methods, but we enforce it in config

# Gemini 2.5 latency/cost control:
# 2.5 models have thinking enabled by default (dynamic). Setting thinking_budget=0 disables it for 2.5 Flash.
DEFAULT_THINKING_BUDGET = 0

# Reproducibility controls
DEFAULT_SEED = 42

# Output control (leave unset by default; can be overridden via CLI)
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
    cmd = [
        "ffprobe", 
        "-v", "error", 
        "-show_entries", "format=duration", 
        "-of", "default=noprint_wrappers=1:nokey=1", 
        video_path
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(result.stdout.strip())
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

def should_rerun_analysis(data):
    """
    Checks if analysis should be re-run due to quality concerns:
    1. Any subcategory rating being 0 (indicates incomplete evaluation)
    2. Final weighted score being less than 68% (below acceptable threshold)
    
    This acts as a quality gate to ensure all sessions are properly evaluated.
    If either condition is triggered, the analysis is re-run to get a more accurate assessment.
    
    Args:
        data (dict): Parsed JSON data from the initial analysis
        
    Returns:
        tuple: (should_rerun: bool, reason: str)
        
    Example:
        >>> data = {"scoring": {"final_weighted_score": 65, "setup": [{"rating": 0}]}}
        >>> should_rerun, reason = should_rerun_analysis(data)
        >>> should_rerun
        True
        >>> reason
        "Category 'setup' subcategory 'Unknown' has rating 0"
    """
    try:
        scoring = data.get("scoring", {})
        final_score = scoring.get("final_weighted_score", 0)
        
        # Check if score is below 68%
        if final_score < 68:
            return True, f"Score {final_score} is below 68% threshold"
        
        # Check if any subcategory has rating 0
        categories = ["setup", "attitude", "preparation", "curriculum", "teaching"]
        for cat in categories:
            if cat in scoring and isinstance(scoring[cat], list):
                for item in scoring[cat]:
                    rating = item.get("rating", 0)
                    if rating == 0:
                        subcategory = item.get("subcategory", "Unknown")
                        return True, f"Category '{cat}' subcategory '{subcategory}' has rating 0"
        
        return False, "Analysis meets quality threshold"
    except Exception as e:
        return False, f"Error checking analysis: {e}"

def compare_and_keep_best(data1, data2):
    """
    Compares two analysis JSON objects and returns the one with the higher score.
    This function is used when analysis is re-run to select the best result.
    
    Args:
        data1 (dict): First analysis result
        data2 (dict): Second (retry) analysis result
        
    Returns:
        tuple: (best_data: dict, score1: float, score2: float, selected: str)
               where selected is either "First" or "Second"
               
    Example:
        >>> data1 = {"scoring": {"final_weighted_score": 72}}
        >>> data2 = {"scoring": {"final_weighted_score": 75}}
        >>> best, s1, s2, sel = compare_and_keep_best(data1, data2)
        >>> sel
        "Second"
        >>> best == data2
        True
    """
    try:
        score1 = data1.get("scoring", {}).get("final_weighted_score", 0)
        score2 = data2.get("scoring", {}).get("final_weighted_score", 0)
        
        if score1 >= score2:
            return data1, score1, score2, "First"
        else:
            return data2, score1, score2, "Second"
    except Exception as e:
        print(f"Error comparing analyses: {e}")
        return data1, 0, 0, "First (default)"

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
                cite = item.get('cite', '')
                time = item.get('timestamp', '')
                html += f'<div class="feedback-box {css_class}"><strong>[{cat}] {sub}:</strong><p>{text}</p>'
                if cite:
                    html += f'<small class="cite">{cite}</small>'
                if time:
                    html += f'<small class="timestamp">⏱️ {time}</small>'
                html += '</div>'
            return html

        def render_flags(items):
            html = ""
            for item in items:
                level = item.get('level', 'Yellow')
                # Determine class based on level
                css_class = "f-box-red" if "Red" in level else "f-box-yellow"
                sub = item.get('subcategory', '')
                reason = item.get('reason', '')
                cite = item.get('cite', '')
                time = item.get('timestamp', '')
                html += f'<div class="feedback-box {css_class}">🚩 <strong>{level} Flag: {sub}</strong><p>{reason}</p>'
                if cite:
                    html += f'<small class="cite">{cite}</small>'
                if time:
                    html += f'<small class="timestamp">⏱️ {time}</small>'
                html += '</div>'
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
        .feedback-box p {{ margin: 8px 0; line-height: 1.5; }}
        .feedback-box .cite {{ display: block; margin-top: 8px; color: #9ca3af; font-size: 0.85rem; }}
        .feedback-box .timestamp {{ display: block; margin-top: 4px; color: #9ca3af; font-size: 0.85rem; }}
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
        # 1. SETUP & EXTRACTION
        if transcript_path is None:
            transcript_path = TRANSCRIPT_PATH
        start_time = DEFAULT_START_TIME
        if os.path.exists(transcript_path):
            start_time = get_start_time_from_transcript(transcript_path)
            
        frames_dir = extract_resources(video_path, start_time)

        # Extract Audio
        audio_path = "temp_audio.mp3"
        extract_audio(video_path, audio_path)

        # 2. UPLOAD EVERYTHING
        print("\n--- Uploading Resources (Sequential) ---")
        files_to_upload = []
        
        if os.path.exists(audio_path):
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
        wait_for_files_active(uploaded_files)

        # 3. INITIALIZE MODEL (Optimized for 2.x Thinking/Flash)
        print("\n--- Initializing Knowledge Base Chat ---")
        
        system_instr = """You are the **Lead Quality Auditor** and **Senior Quality Compliance Auditor** for iSchool.
Your task is to conduct a **Forensic Quality Review** of online coding sessions.

**AUDIT PROTOCOL:**
1. **INGEST RULES:** Analyze the provided Quality Reference PDFs.
2. **ANALYZE SESSION:** Cross-reference Audio (MP3), Frames (JPG), and Transcript (TXT) against the rules.
    - listen for MP3 from uploaded file between tutor and student.
    - check frames from uploaded files.
    - read zoom transcript from uploaded file.
    **AUDIO VS. TRANSCRIPT RULE:**
    You possess both the Recording (Audio) and the Script (Transcript).
- The Transcript is for **Timestamping**.
- The Audio is for **Verification**.
- IF the transcript says "(silence)" but the audio contains keyboard clicking -> IT IS NOT SILENCE.
- IF the transcript looks polite but the audio sounds angry -> TRUST THE AUDIO.
- You must prioritize Audio evidence for all "Attitude" and "Connection" findings.
3. **STRICT GUIDELINES:**
    - Be EXHAUSTIVE. List EVERY issue found, no matter how small.
    - Reference the provided Comment Bank PDF for rule citations.
    - Use exact Category keys: S(Setup), A(Attitude), P(Preparation), C(Curriculum), T(Teaching), F(Feedback).
    - Results must be mathematically verified using the weighted formula.
**CRITICAL ANTI-HALLUCINATION RULE:**
Do NOT report ANY issue unless you have SPECIFIC EVIDENCE:
- For transcript issues: Include an EXACT QUOTE from the transcript.
- For visual issues: Reference the SPECIFIC FRAME NUMBER or Timestamp.
- If you cannot cite a specific quote or frame, DO NOT include the issue.

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
- **POSITIVE FEEDBACK:** You MUST include at least **2** specific positive observations in the `positive_feedback` array.
- language English or Arabic do not put language used in area of improvement.
- if the find with not storng and clraer evidence, do not include it.

---

### **PHASE 1: THE AUDIT PROTOCOL (Relaxed Enforcement)**
Check the session against these specific criteria. If a violation is found, it **MUST** be listed in "areas_for_improvement" or "flags".
Note the exact timestamp from the transcript where the issue occurs.
Note the Arabic is allowed don't mention it in the report unless technical terms are mispronounced.

**IMPORTANT: 1-HOUR SESSION CONTEXT**
Do NOT report the following as issues:
- Brief moments of silence (under 2 min) while student is coding/thinking.
- Tutor briefly checking slides or materials (under 30 seconds).
- One or two instances of minor audio lag that don't disrupt flow.
- the session could be 1 hour and 30 minutes.with the wating time for the student. 
**1. VISUAL COMPLIANCE (Check Frames)**
*   **Camera (IGNORE FOR REPORTING):** Do NOT add any comments, improvements, or flags about camera angle, framing, or visibility.
    - **Specifically, ignore and do not report "S - Camera Quality" findings.**
*   **Screen Sharing (CRITICAL):**
    *   During the "Make/Coding" phase, the **STUDENT'S** screen must be shared.
    *   *Violation:* If the tutor explicitly says "You don't have to share your screen,"for reviweing the homework or implmenting main the project at the end of the session .
*   **Zoom Tools Usage (MANDATORY CHECK):**
    *   If the tutor repeatedly uses verbal directions **more than 3 times** like “look above” instead of Zoom annotations (arrow/highlighter), log:
      **C - Tools and Methodology: Inefficient use of Zoom annotation tools**.

**2. AUDITORY COMPLIANCE (Check Transcript + Audio)**
*   **Dead Air (Silence):** Flag if silence exceeds **6 minutes** without tutor engagement or check-in. 
*   **Rapport & Warmth (MANDATORY CHECK):**
    * If the tutor does NOT smile, greet warmly, or initiate light friendly conversation log:
      **A - Friendliness: Lack of warm rapport-building at session start**.
*   **Language:** Arabic is ALLOWED.
*   **Internet & Audio Stability (MANDATORY CHECK):**
    - if it is more than 3 time Actively listen for lag, delayed responses, repeated “can you hear me?”, audio cuts, or desync.
    - If connectivity issues affect flow **for more than 2 minutes** more than 3 times, log:
      **S - Internet Quality: Internet/audio lags disrupted session flow for more than 3 minutes**.

**3. PREPARATION QUALITY (MANDATORY CHECK):**
*   **Materials Readiness:**
    * If slides are disorganized, contain typos, or seem hastily prepared, log:
      **P - Material Readiness: Materials were not well-organized or prepared in advance**.
    * If the tutor lacks resources/materials for the session topic, log:
      **P - Resource Planning: Required materials or setup were missing or not prepared**.
*   **Lesson Planning & Roadmap:**
    * If the tutor does not provide a clear lesson plan, roadmap, or learning objectives, log:
      **P - Lesson Planning: No clear lesson plan or learning objectives communicated**.
    * If the pacing is erratic (rushing parts, spending too long on others), log:
      **P - Session Pacing: Poor time management and pacing of lesson content**.
*   **Technical Setup Verification:**
    * If the tutor failed to test tools/platforms before the session or has technical issues that could have been prevented, log:
      **P - Technical Preparation: Technical tools or platforms were not tested/verified beforehand**.

**4. TEACHING QUALITY (MANDATORY DEEP CHECK):**
*   **Teaching Mode Balance:**
    * If teaching is mostly one-directional (explaining without questioning) for >10 minutes, log:
      **T - Student Engagement: Session was largely lecture-based with limited student interaction**.
*   **Guided Thinking vs Direct Answers:**
    * If the tutor provides full solutions, syntax, or logic immediately without prompting the student to think or respond first, log:
      **T - Teaching Methodology: Over-reliance on direct answers instead of guided discovery**.
*   **Check-for-Understanding (MANDATORY):**
    * If the tutor explains a concept without asking the student to confirm understanding, log:
      **T - Student Engagement: Lack of comprehension-check questions during explanation**.

**4. PROCEDURAL COMPLIANCE (Check Transcript + Audio)**
*   **Opening/Closing:** Roadmap explained? Summary provided? Homework assigned?
*   **Platform:** Correct tool used ?
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
    - Misuse or misinterpretation of properties 
    - Logical inaccuracies 
### **FINAL COMPLIANCE GATE (REQUIRED)**
Before producing the final JSON output, explicitly ask yourself:
“Did I check Setup, Attitude, Preparation, Curriculum, Teaching, and Feedback for at least ONE potential issue each?”
If any category has zero findings, re-scan audio, frames, and transcript to confirm that the category is genuinely perfect — otherwise add the missing issue.
if the find with not storng and clraer evidence, do not include it.

---

### **PHASE 2: JSON GENERATION RULES**

**1. THE "LIST ALL" RULE:**
*   **DO NOT SUMMARIZE.** You must list **EVERY** single valid area for improvement found.
*   Check the transcript for timestamps and listen for the audio to validate the findings.
*   **EVIDENCE FILTERING:** Only include findings with STRONG, CLEAR, and SPECIFIC evidence from the transcript, frames, or audio. Do NOT include vague, assumption-based, or unsubstantiated findings.


**2. FORMATTING RULE:**
*   For the `"text"` field in feedback lists, use the exact format: `[Category Letter] - [Subcategory]: [Description ] - [Evidence: Specific example with 1-2 timestamps only]`
*   **CRITICAL:** Include ONLY 1-2 representative timestamps per feedback item. DO NOT list 50+ timestamps.
*   **EVIDENCE REQUIREMENT:** ONLY include findings with STRONG, CLEAR, and SPECIFIC evidence. If a finding lacks concrete proof or is based on assumptions, DO NOT include it.
*   **Category Keys:** **S** = Setup, **A** = Attitude, **P** = Preparation, **C** = Curriculum, **T** = Teaching, **F** = Feedback.

---

### **PHASE 3: RIGOROUS SCORING LOGIC**
**You must calculate the score based strictly on the findings from Phase 2. Do not guess.**

**Step A: Determine Sub-Category Ratings (0-5)**
For **EACH** sub-category in the JSON `scoring` object, apply this specific deduction logic:
*   **5 (Perfect):** 0 Issues found.
*   **4 (Good):** **1-4 "Areas for Improvement"**from the same sub-category.
*   **3 (Fair):**5-6 "Areas for Improvement"** from the same sub-category.
*   **2 (Weak):** 3+  Yellow Flags from the same subcategory  **OR** **6+ "Areas for Improvement"** from the same sub-category.
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
        # Extract file objects from tuples for content list
        pdf_files = [t[0] for t in pdf_objs]
        transcript_files = [t[0] for t in transcript_objs]
        frame_files = [t[0] for t in frame_objs]
        audio_files = [t[0] for t in audio_objs]
        
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[combined_prompt] + pdf_files + transcript_files + frame_files + audio_files,
            config=generation_config
        )
        initial_json = response.text.strip()
        
        # 5. STEP 2: SELF-AUDIT
        print("\n--- Step 2: Performing Self-Audit ---")
        audit_prompt = f"""
Review the following Quality Analysis JSON and perform a **Deep Audit**:
) AREAS FOR IMPROVEMENT: Be exhaustive. Re-check the session resources against the 4 PDFs.
2) Language: Arabic is ALLOWED. Do NOT flag Arabic usage unless a PDF rule explicitly requires otherwise.
3) POSITIVE FEEDBACK: Ensure there are at least 2 distinct positive highlights; if fewer than 3, find more from the session data.
4) Accuracy: Timestamps and evidence must be precise and cited with claer evdince.
5) No redundancy: Ensure all comments are unique (no repeated meaning/text).
6) Group related issues into single comments where appropriate.
7) FLAGS: Verify all Yellow/Red flags are justified with specific evidence from the session.
8) FORMATTING: Keep feedback text CONCISE. Use only 1-3 representative timestamps per item. DO NOT list 50+ timestamps in evidence.
9) Calculations: Re-calculate and correct the weighted score to ensure 100% mathematical accuracy.
**Remove any comment that lacks evidence. and recale the score don't be like a robot**
Hard constraints:
- Return ONLY valid JSON matching the existing schema. Do not add new top-level keys.
- Do NOT include any camera angle/framing/visibility/camera quality findings.
- Do NOT include generic session feedback items (category F / session feedback).
- Keep all "text" fields concise (max 600 chars per item) and must have evidence.
- For repeated behaviors, use: "The tutor consistently [action] at [timestamp] and throughout the session" instead of listing 50+ times and add evidence.
- Comments from the removed Comments Bank PDF should NOT be included.
**INPUT JSON:**
{initial_json}

**REQUIRED OUTPUT:**
Corrected and finalized JSON ONLY. Valid JSON format.
"""
        final_response = client.models.generate_content(
            model=MODEL_NAME,
            contents=audit_prompt,
            config=generation_config
        )
        final_json_text = final_response.text.strip()

        # Extract JSON from potential markdown blocks
        if "```json" in final_json_text:
            final_json_text = final_json_text.split("```json")[1].split("```")[0].strip()
        elif "```" in final_json_text:
            final_json_text = final_json_text.split("```")[1].split("```")[0].strip()

        # --- SCORE RECALCULATION ---
        def recalculate_score(json_text):
            """Recalculates score from JSON data."""
            try:
                data = json.loads(json_text)
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
                    return json.dumps(data, indent=2), data
                return json_text, {}
            except Exception as e:
                print(f"[WARNING] Score recalculation failed: {e}")
                return json_text, {}
        
        # First analysis
        MAX_RERUN_ATTEMPTS = 1  # Maximum 1 retry (2 total attempts)
        attempt = 1
        final_json_text, data1 = recalculate_score(final_json_text)
        score1 = data1.get("scoring", {}).get("final_weighted_score", 0)
        print(f"[SUCCESS] Score Recalculated (Attempt {attempt}/{MAX_RERUN_ATTEMPTS + 1}): {score1}")
        
        # CHECK IF RERUN IS NEEDED
        should_rerun, reason = should_rerun_analysis(data1)
        if should_rerun and attempt < MAX_RERUN_ATTEMPTS + 1:
            attempt += 1
            print(f"\n[ALERT] {reason}")
            print(f"[RERUN] Attempt {attempt}/{MAX_RERUN_ATTEMPTS + 1} - Re-analyzing session to get better results...")
            
            # Re-run the audit without re-uploading files
            retry_audit_prompt = f"""
Review the session resources again and generate a **completely fresh Quality Analysis JSON** with careful attention to detail.
Be exhaustive in finding issues. Re-check each category thoroughly.

**CRITICAL REQUIREMENTS:**
1. Every subcategory MUST have a rating between 1-5 (NO ZERO RATINGS)
2. Score should NOT be below 68% unless genuinely justified
3. Include detailed evidence for every finding
4. Only include findings with STRONG, CLEAR, and SPECIFIC evidence - do NOT include vague or assumption-based findings
5. Double-check all category calculations

Hard constraints:
- Return ONLY valid JSON matching the schema. Do not add new top-level keys.
- Do NOT include camera angle/framing/visibility findings.
- Do NOT include generic session feedback items (category F).
- Keep all "text" fields concise (max 600 chars) with evidence.
- Comments from the removed Comments Bank PDF should NOT be included.

**INPUT:** Re-analyze the uploaded session resources.

**REQUIRED OUTPUT:** Fresh, corrected JSON ONLY in valid JSON format.
"""
            retry_response = client.models.generate_content(
                model=MODEL_NAME,
                contents=[retry_audit_prompt] + pdf_files + transcript_files + frame_files + audio_files,
                config=generation_config
            )
            retry_json_text = retry_response.text.strip()
            
            # Extract JSON from potential markdown blocks
            if "```json" in retry_json_text:
                retry_json_text = retry_json_text.split("```json")[1].split("```")[0].strip()
            elif "```" in retry_json_text:
                retry_json_text = retry_json_text.split("```")[1].split("```")[0].strip()
            
            retry_json_text, data2 = recalculate_score(retry_json_text)
            score2 = data2.get("scoring", {}).get("final_weighted_score", 0)
            print(f"[RETRY] Score Recalculated (Attempt {attempt}/{MAX_RERUN_ATTEMPTS + 1}): {score2}")
            
            # Compare and keep best
            best_data, s1, s2, selected = compare_and_keep_best(data1, data2)
            print(f"[COMPARISON] Score 1: {s1} vs Score 2: {s2} -> Keeping {selected} Analysis (Score: {best_data.get('scoring', {}).get('final_weighted_score', 0)})")
            
            final_json_text = json.dumps(best_data, indent=2)
        else:
            if not should_rerun:
                print(f"[INFO] {reason} - No rerun needed")
            else:
                print(f"[INFO] Maximum rerun attempts ({MAX_RERUN_ATTEMPTS}) reached. Using best available result.")

        # Save Reports
        json_report_path = os.path.splitext(output_report_path)[0] + ".json"
        with open(json_report_path, 'w', encoding='utf-8') as f:
            f.write(final_json_text)
        
        with open(output_report_path, 'w', encoding='utf-8') as f:
            f.write(final_json_text) # For legacy compatibility during transition

        print(f"[SUCCESS] Structured Reports saved (.json and .txt)")

        # 6. GENERATE HTML
        generate_html_report_from_json(json_report_path)

        # Final Cost Details
        in_t = response.usage_metadata.prompt_token_count if response.usage_metadata else 0
        out_t = response.usage_metadata.candidates_token_count if response.usage_metadata else 0
        in_t_a = final_response.usage_metadata.prompt_token_count if final_response.usage_metadata else 0
        out_t_a = final_response.usage_metadata.candidates_token_count if final_response.usage_metadata else 0
        
        total_cost = ((in_t + in_t_a) / 1e6 * COST_PER_MILLION_INPUT_TOKENS) + ((out_t + out_t_a) / 1e6 * COST_PER_MILLION_OUTPUT_TOKENS)
        print(f"Analysis complete. Total Tokens: {in_t + in_t_a + out_t + out_t_a} | Total Cost: ${total_cost:.4f}")

    except Exception as e:
        print(f"Error in RAG analysis: {e}")
        import traceback
        traceback.print_exc()
        import sys
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=VIDEO_FILE_PATH)
    parser.add_argument("--output_report", default=OUTPUT_REPORT_TXT)
    parser.add_argument("--transcript", default=TRANSCRIPT_PATH)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Random seed for reproducibility")
    parser.add_argument("--thinking_budget", type=int, default=DEFAULT_THINKING_BUDGET, help="Thinking budget for Gemini 2.5 Flash (0 disables thinking)")
    parser.add_argument("--max_output_tokens", type=int, default=DEFAULT_MAX_OUTPUT_TOKENS, help="Maximum output tokens (None = model default)")
    args = parser.parse_args()
    
    perform_rag_analysis(args.input, args.output_report, args.transcript)