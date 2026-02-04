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
API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyAexYhJOKE7YF6LMsjOTpsdSmUnaFzewz4")

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

# ============================================================================
# DETERMINISTIC CONFIGURATION (Gemini 3.0 Flash)
# ============================================================================
# Gemini 3.0 Flash Preview
# - Latest generation Flash model
# - optimized for speed and multimodal understanding
# - Supports deterministic sampling with temp=0
# ============================================================================

MODEL_TEMPERATURE = 0.0   # Deterministic: Low randomness for consistency
MODEL_TOP_P = 0.95        # Standard Nucleus Sampling (slight flexibility)
MODEL_TOP_K = 40          # Standard decoding: Best balance for reasoning vs consistency
# candidate_count: 1 is implicitly 1 for most SDK methods

# Gemini 3.0 Thinking Control:
# Use 'thinking_level' for Gemini 3. Options: "minimal", "low", "high"
# - "minimal": Best for DETERMINISM and simple rule following.
# - "high": Good for complex reasoning but increases variance (less deterministic).
DEFAULT_THINKING_LEVEL = "minimal"

# Gemini 2.0 Flash media resolution for vision processing
# Controls token usage and latency for multimodal inputs
# Options: MEDIA_RESOLUTION_LOW, MEDIA_RESOLUTION_MEDIUM, MEDIA_RESOLUTION_HIGH
DEFAULT_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_MEDIUM"

# Gemini 2.0 Flash media resolution for vision processing
# Controls token usage and latency for multimodal inputs
# Options: MEDIA_RESOLUTION_LOW, MEDIA_RESOLUTION_MEDIUM, MEDIA_RESOLUTION_HIGH
DEFAULT_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_MEDIUM"

# Reproducibility controls
# The seed parameter provides PARTIAL reproducibility (not guaranteed deterministic)
DEFAULT_SEED = 42

# ============================================================================
# SINGLE-RUN MODE (COST-EFFECTIVE)
# ============================================================================
# Gemini 2.0 Flash is generally deterministic with temp=0.
# The seed parameter provides PARTIAL reproducibility but some variance is expected.
# 
# For best single-run reproducibility:
# - Use temperature=0.0
# - Use seed parameter
# ============================================================================
DEFAULT_CONSISTENCY_RUNS = 1  # Single run (cost-effective)

# Output control (leave unset by default; can be overridden via CLI)
DEFAULT_MAX_OUTPUT_TOKENS = None

# Retry control for API failures / JSON parse errors
MAX_JSON_RETRIES = 3
MAX_EMPTY_JSON_RETRIES = 2  # Retries specifically for empty JSON responses

# Score variance threshold - if runs differ by more than this, flag as unreliable
SCORE_VARIANCE_THRESHOLD = 5.0  # Points

# Costs (Gemini 3.0 Flash Preview - Estimated pricing)
# Pricing: ~$0.075/million input, ~$0.30/million output
COST_PER_MILLION_INPUT_TOKENS = 0.075
COST_PER_MILLION_OUTPUT_TOKENS = 0.30

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
            # Try VTT format first: 00:13:17.540 --> 00:13:18.659
            match = re.search(r'(\d{2}:\d{2}:\d{2})', content)
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

def validate_json_response(json_text):
    """
    Validates that the JSON response is complete and properly structured.
    Returns (is_valid, data_or_error_msg)
    
    A valid response must have:
    1. Valid JSON syntax
    2. Non-empty object (not {})
    3. Required top-level keys: meta, scoring
    4. Scoring section with at least one category
    """
    try:
        # Check for empty or whitespace-only response
        if not json_text or not json_text.strip():
            return False, "Empty response received"
        
        # Parse JSON
        data = json.loads(json_text)
        
        # Check for empty object
        if not data or data == {}:
            return False, "Empty JSON object received ({})"
        
        # Check required top-level keys
        required_keys = ["meta", "scoring"]
        missing_keys = [k for k in required_keys if k not in data]
        if missing_keys:
            return False, f"Missing required keys: {missing_keys}"
        
        # Check scoring has content
        scoring = data.get("scoring", {})
        if not scoring:
            return False, "Scoring section is empty"
        
        # Check at least one category has ratings
        categories = ["setup", "attitude", "preparation", "curriculum", "teaching"]
        has_ratings = False
        for cat in categories:
            if cat in scoring and isinstance(scoring[cat], list) and len(scoring[cat]) > 0:
                has_ratings = True
                break
        
        if not has_ratings:
            return False, "No category ratings found in scoring"
        
        return True, data
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON syntax: {e}"
    except Exception as e:
        return False, f"Validation error: {e}"

def compute_median_score(scores):
    """
    Computes the median score from a list of scores.
    The median is more robust to outliers than the mean.
    """
    if not scores:
        return 0
    sorted_scores = sorted(scores)
    n = len(sorted_scores)
    if n % 2 == 1:
        return sorted_scores[n // 2]
    else:
        return (sorted_scores[n // 2 - 1] + sorted_scores[n // 2]) / 2

def select_best_analysis_by_median(analyses):
    """
    Given multiple analysis results, selects the one closest to the median score.
    This ensures we pick a representative analysis, not an outlier.
    
    Args:
        analyses: List of (json_text, data_dict, score) tuples
        
    Returns:
        tuple: (best_json_text, best_data, median_score, all_scores, variance)
    """
    if not analyses:
        return None, {}, 0, [], 0
    
    scores = [a[2] for a in analyses]
    median = compute_median_score(scores)
    
    # Calculate variance
    variance = max(scores) - min(scores) if len(scores) > 1 else 0
    
    # Find analysis closest to median
    best_idx = 0
    min_diff = abs(scores[0] - median)
    for i, score in enumerate(scores):
        diff = abs(score - median)
        if diff < min_diff:
            min_diff = diff
            best_idx = i
    
    best_json, best_data, best_score = analyses[best_idx]
    
    # Update the score in data to be the median for consistency
    if "scoring" in best_data:
        best_data["scoring"]["final_weighted_score"] = round(median, 1)
        best_data["scoring"]["_consistency_info"] = {
            "individual_scores": scores,
            "median_score": round(median, 1),
            "score_variance": round(variance, 1),
            "runs": len(scores),
            "reliable": variance <= SCORE_VARIANCE_THRESHOLD
        }
        best_json = json.dumps(best_data, indent=2)
    
    return best_json, best_data, median, scores, variance

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

        # 3. INITIALIZE MODEL (Optimized for Gemini 3 Flash)
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
    - Reference the provided PDFs for rule citations.
    - Use exact Category keys: S(Setup), A(Attitude), P(Preparation), C(Curriculum), T(Teaching), F(Feedback).
    - Results must be mathematically verified using the weighted formula.
**CRITICAL ANTI-HALLUCINATION RULE:**
Do NOT report ANY issue unless you have SPECIFIC EVIDENCE:
- For transcript issues: Include an EXACT QUOTE from the transcript.
- For visual issues: Reference the SPECIFIC FRAME NUMBER or Timestamp.
- If you cannot cite a specific quote or frame, DO NOT include the issue.

**OUTCOME:** Return ONLY a valid JSON object matching the required schema."""

        # Model configuration with seed for determinism
        # NOTE: Gemini 3.0 Flash uses thinking_level or disabled thinking
        # "minimal" ensures the closest behavior to deterministic output.
        gen_config_kwargs = dict(
            temperature=MODEL_TEMPERATURE,
            top_p=MODEL_TOP_P,
            top_k=MODEL_TOP_K,
            candidate_count=1,
            response_mime_type="application/json",
            system_instruction=system_instr,
            seed=args.seed if hasattr(args, 'seed') else DEFAULT_SEED,
            media_resolution=args.media_resolution if hasattr(args, 'media_resolution') else DEFAULT_MEDIA_RESOLUTION,
        )
        
        # Apply Thinking Config ONLY if thinking_level is passed and supported
        # For strict determinism, we might prefer NO thinking config (defaults to off)
        # But if the user wants "minimal" thinking:
        current_thinking_level = args.thinking_level if hasattr(args, 'thinking_level') else DEFAULT_THINKING_LEVEL
        if current_thinking_level:
             # Assuming SDK supports this parameter. If not, remove it.
             # Based on research, Gemini 3 uses 'thinking_level' but let's be careful.
             pass 
             # For now, let's DISABLE active thinking injection to ensure max stability unless explicitly requested
             # gen_config_kwargs["thinking_config"] = ... 
        
        # Enable Google Search (Community Search) if requested
        if hasattr(args, 'use_google_search') and args.use_google_search:
            print("--- Googling Search (Community Search) ENABLED ---")
            gen_config_kwargs["tools"] = [types.Tool(google_search=types.GoogleSearch())]
            
        if args.max_output_tokens is not None:
            gen_config_kwargs["max_output_tokens"] = args.max_output_tokens

        generation_config = types.GenerateContentConfig(**gen_config_kwargs)
        
        # 4. STEP 1: INITIAL GENERATION
        print("\n--- Step 1: Generating Initial Analysis JSON ---")
        combined_prompt = f"""
Analyze the session files provided (Guidelines, Transcript, Frames, Audio).
Generate a comprehensive Quality Audit Report in JSON format.

**CRITICAL: SESSION START TIME**
The session officially starts at timestamp **{start_time}**.
**IGNORE** all audio, text, or visual events before **{start_time}**.
Any "silence" or "waiting" before {start_time} is PRE-SESSION WAITING time and is NOT a violation.

**REQUIRED SCHEMA:**
{{
  "_reasoning_trace": ["Step 1: Analyzed setup...", "Step 2: Found issue X at timestamp...", "Step 3: Verified rule Y..."],
  "meta": {{"tutor_id": "str", "group_id": "str", "session_date": "str", "session_summary": "str"}},
  "positive_feedback": [{{"category": "str", "subcategory": "str", "text": "str", "cite": "str", "timestamp": "str"}}],
  "areas_for_improvement": [{{"category": "str", "subcategory": "str", "text": "str", "cite": "str", "timestamp": "str"}}],
  "flags": [{{"level": "Yellow/Red", "subcategory": "str", "reason": "str", "cite": "str", "timestamp": "str"}}],
  "scoring": {{
    "setup": [{{"subcategory": "str", "rating": 0, "reason": "str"}}],
    "attitude": [{{"subcategory": "str", "rating": 0, "reason": "str"}}],
    "preparation": [{{"subcategory": "str", "rating": 0, "reason": "str"}}],
    "curriculum": [{{"subcategory": "str", "rating": 0, "reason": "str"}}],
    "teaching": [{{"subcategory": "str", "rating": 0, "reason": "str"}}],
    "averages": {{"setup": 0, "attitude": 0, "preparation": 0, "curriculum": 0, "teaching": 0}},
    "final_weighted_score": 0
  }},
  "action_plan": ["string", "string", "string"]
}}

**RULES:**
- **CHAIN OF THOUGHT:** You MUST populate the `_reasoning_trace` array FIRST with your step-by-step analysis. This is your "scratchpad" to ensure accuracy.
- Category Keys: **S** (Setup), **A** (Attitude), **P** (Preparation), **C** (Curriculum), **T** (Teaching), **F** (Feedback).
- Scoring Logic: 5 (Perfect) down to 1 (Critical). Apply weighted formula: (Setup 25%, Attitude 20%, Prep 15%, Curr 15%, Teach 25%).
- Math Verification: Re-calculate category averages and sum them based on weights before outputting the final score.
- **POSITIVE FEEDBACK:** You MUST include at least **3** specific positive observations in the `positive_feedback` array.
- language English or Arabic do not put language used in area of improvement.
- if the find with not storng and clraer evidence, do not include it.

---

### **PHASE 1: THE AUDIT PROTOCOL (Relaxed Enforcement)**
Check the session against these specific criteria. If a violation is found, it **MUST** be listed in "areas_for_improvement" or "flags".
Note the exact timestamp from the transcript where the issue occurs.

**IMPORTANT: 1-HOUR SESSION CONTEXT**
Do NOT report the following as issues:
- Brief moments of silence (under 2 min) while student is coding/thinking.
- Tutor briefly checking slides or materials (under 30 seconds).
- One or two instances of minor audio lag that don't disrupt flow.
- the session could be 1 hour and 30 minutes.with the wating time for the student. 
**1. VISUAL COMPLIANCE (Check Frames)**
*   **Camera (IGNORE FOR REPORTING):** Do NOT add any comments, improvements, or flags about camera angle, framing, or visibility.
    - **Specifically, ignore and do not report "S - Camera Quality" findings.**
*   **Dress Code (IGNORE FOR REPORTING):** Do NOT add any comments, improvements, or flags about the tutor's dress code/appearance.
    - **Specifically, ignore and do not report "S - Dress Code" findings.**
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

***1. THE "LIST ALL" RULE:**
*   **DO NOT SUMMARIZE.** You must list **EVERY** single valid area for improvement found.
*   Check the transcript for timestamps and listen for the audio to validate the findings.
*   **EVIDENCE FILTERING:** Only include findings with STRONG, CLEAR, and SPECIFIC evidence.
*   **EVIDENCE LANGUAGE:** Quote the specific evidence exactly as spoken/written in the session, in its original language (Arabic or English). Do NOT translate quotes.


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
*   **1 (Critical):** **10+ "Areas for Improvement"** from the same sub-category..
*   **0 (Zero):** No show/Total failure.

**Step B: Apply the Weighted Formula**
Calculate the `final_weighted_score` using these exact weights:
- **Setup (25%):** `(Setup Avg ÷ 5) × 100 × 0.25`
- **Attitude (20%):** `(Attitude Avg ÷ 5) × 100 × 0.20`
- **Preparation (15%):** `(Preparation Avg ÷ 5) × 100 × 0.15`
- **Curriculum (15%):** `(Curriculum Avg ÷ 5) × 100 × 0.15`
- **Teaching (25%):** `(Teaching Avg ÷ 5) × 100 × 0.25`

**Step C: MANDATORY MATH VERIFICATION (SELF-AUDIT)**
Before finalizing the JSON, you MUST internaly verify your calculations and facts:
1) **EVIDENCE CHECK:** Ensure EVERY "area_for_improvement" and "flag" has specific evidence (timestamp/quote). Remove any that do not.
2) **SCORE CHECK:** Re-calculate category averages and valid weights. The final score must match the individual ratings perfectly.
3) **POSITIVE CHECK:** Ensure at least 3 distinct positive highlights are included.
4) **LANGUAGE CHECK:** Arabic is ALLOWED. Do not flag uses of Arabic.
5) **FORMAT CHECK:** Ensure "text" fields are concise  and evidence is clear.

**Remove any comment that lacks evidence. and recale the score don't be like a robot**
Hard constraints:
- Return ONLY valid JSON matching the existing schema.
- Do NOT include any camera angle/framing/visibility/camera quality findings.
- Do NOT include generic session feedback items (category F / session feedback).
- Keep all "text" fields concise using the format: `[Category Letter] - [Subcategory]: [Description ] - [Evidence: ...]`
- Comments from the removed Comments Bank PDF should NOT be included.

"""
        # Extract file objects from tuples for content list
        pdf_files = [t[0] for t in pdf_objs]
        transcript_files = [t[0] for t in transcript_objs]
        frame_files = [t[0] for t in frame_objs]
        audio_files = [t[0] for t in audio_objs]
        
        # 4. STEP 1: INITIAL GENERATION
        print("\n--- Step 1: Generating Initial Analysis JSON ---")
        
        response_1 = client.models.generate_content(
            model=MODEL_NAME,
            contents=[combined_prompt] + pdf_files + transcript_files + frame_files + audio_files,
            config=generation_config
        )
        initial_json = response_1.text.strip()
        
        # Extract JSON from markdown or raw text
        if "```json" in initial_json:
            initial_json = initial_json.split("```json")[1].split("```")[0].strip()
        elif "```" in initial_json:
            initial_json = initial_json.split("```")[1].split("```")[0].strip()
        
        # Validate initial JSON
        is_valid_initial, initial_validation = validate_json_response(initial_json)
        retry_count = 0
        
        while not is_valid_initial and retry_count < MAX_EMPTY_JSON_RETRIES:
            retry_count += 1
            print(f"[WARNING] Invalid Initial JSON: {initial_validation}")
            print(f"[RETRY] Regenerating Step 1 (retry {retry_count}/{MAX_EMPTY_JSON_RETRIES})...")
            
            response_1 = client.models.generate_content(
                model=MODEL_NAME,
                contents=[combined_prompt + "\n\nCRITICAL: Return a complete, valid JSON object."] + pdf_files + transcript_files + frame_files + audio_files,
                config=generation_config
            )
            initial_json = response_1.text.strip()
            if "```json" in initial_json:
                initial_json = initial_json.split("```json")[1].split("```")[0].strip()
            elif "```" in initial_json:
                initial_json = initial_json.split("```")[1].split("```")[0].strip()
            is_valid_initial, initial_validation = validate_json_response(initial_json)
        
        if not is_valid_initial:
             print(f"[ERROR] Step 1 Failed: {initial_validation}")
             # Proceed to Step 2 anyway if possible, or fail? 
             # We need Step 1 output for Step 2. If Step 1 fails, we can't really do Step 2 effectively.
             # However, let's try to proceed with what we have to avoid full crash.

        # Process Step 1 Result
        initial_json, data_step1 = recalculate_score(initial_json)
        score_step1 = data_step1.get("scoring", {}).get("final_weighted_score", 0)
        
        step1_report_path = os.path.splitext(output_report_path)[0] + "_Step1.json"
        with open(step1_report_path, 'w', encoding='utf-8') as f:
            f.write(initial_json)
        print(f"[SUCCESS] Step 1 Analysis Saved (Score: {score_step1}): {step1_report_path}")

        # 5. STEP 2: SELF-AUDIT (RESTORED)
        print("\n--- Step 2: Deep Audit & Verification (With Full Context) ---")
        
        audit_prompt = f"""
You are the **Senior Quality Compliance Auditor**.
Your task is to **AUDIT and CORRECT** the "Draft Analysis JSON" provided below.

**THE DRAFT MAY CONTAIN ERRORS. DO NOT TRUST IT BLINDLY.**
You have access to the **ACTUAL** session evidence (Audio, Frames, Transcript).
You must verify every single claim in the draft against this evidence.

**AUDIT PROTOCOL:**
1.  **VERIFY EVIDENCE:**
    - If the draft says "Issue X at 10:00", **check the transcript/audio at 10:00**.
    - If the evidence does NOT support the claim, **DELETE IT**.
    - If the evidence is weak or ambiguous, **DELETE IT**.
    - **CRITICAL:** Start Time is **{start_time}**. ANY issue cited before this timestamp is invalid and MUST be deleted.

2.  **HUNT FOR MISSED ISSUES:**
    - The draft might have missed something. Re-scan the "teaching" and "interaction" phases.
    - Did the tutor check for understanding? Did they engage the student?
    - If you find a new valid issue backed by strong evidence, **ADD IT**.

3.  **STRICT SCORING CORRECTION:**
    - Recalculate the score based *only* on the valid findings that remain.
    - If you deleted issues, the score MUST go VALID (Up).
    - If you added issues, the score MUST go DOWN.
    - **Do not be lazy.** Do not just copy the draft score. Calculate it yourself.

4.  **REFINEMENT:**
    - **Language:** Arabic is ALLOWED. Remove any flags strictly about speaking Arabic.
    - **Positive Highlights:** Ensure at least 3 distinct, true positives are listed.
    - **Conciseness:** Merge repetitive points. Use "Consistently..." for recurring behaviors.
    - **Evidence Format:** Ensure every finding has: `[Category] - [Subcategory]: [Description] - [Evidence: ...]`

**INPUT DRAFT JSON:**
{initial_json}

**REQUIRED OUTPUT:**
The clean, corrected, and finalized JSON.
"""
        response_2 = client.models.generate_content(
            model=MODEL_NAME,
            contents=[audit_prompt] + pdf_files + transcript_files + frame_files + audio_files,
            config=generation_config
        )
        final_json_text = response_2.text.strip()
        
        # Extract JSON from markdown
        if "```json" in final_json_text:
            final_json_text = final_json_text.split("```json")[1].split("```")[0].strip()
        elif "```" in final_json_text:
            final_json_text = final_json_text.split("```")[1].split("```")[0].strip()

        # Validate Final JSON
        is_valid, validation_result = validate_json_response(final_json_text)
        
        if not is_valid:
            print(f"[ERROR] Step 2 Invalid JSON: {validation_result}. Falling back to Initial JSON.")
            final_json_text = initial_json
            is_valid = is_valid_initial
        
        # --- SCORE RECALCULATION ---
        # (Using global recalculate_score function)

        
        # Final Processing
        final_json_text, data2 = recalculate_score(final_json_text)
        score2 = data2.get("scoring", {}).get("final_weighted_score", 0)
        
        step2_report_path = os.path.splitext(output_report_path)[0] + "_Step2.json"
        with open(step2_report_path, 'w', encoding='utf-8') as f:
            f.write(final_json_text)
        print(f"[SUCCESS] Step 2 Analysis Saved (Score: {score2}): {step2_report_path}")

        # DECISION: Keep Lower Score (Safe Mode)
        print(f"\n--- Score Comparison ---")
        print(f"Step 1 Score: {score_step1}")
        print(f"Step 2 Score: {score2}")
        
        if score_step1 < score2:
             print(">>> Step 1 is lower. Reverting to Step 1 findings as standard.")
             final_json_text = initial_json
             final_data = data_step1
             final_score = score_step1
        else:
             print(">>> Step 2 is lower (or equal). Keeping Audit findings.")
             final_json_text = final_json_text
             final_data = data2
             final_score = score2

        # Save Final Report
        json_report_path = os.path.splitext(output_report_path)[0] + ".json"
        with open(json_report_path, 'w', encoding='utf-8') as f:
            f.write(final_json_text)
        
        with open(output_report_path, 'w', encoding='utf-8') as f:
            f.write(final_json_text) 

        print(f"[SUCCESS] Final Structured Reports saved (.json and .txt)")

        # 6. GENERATE HTML
        generate_html_report_from_json(json_report_path)
        
        # 7. CONSISTENCY TRACKING
        # Track scores across runs for the same session to detect variance
        session_id = os.path.basename(os.path.dirname(output_report_path))  # e.g., "T-4092"
        consistency_log_path = os.path.join(os.path.dirname(output_report_path), f"{session_id}_consistency_log.json")
        
        try:
            if os.path.exists(consistency_log_path):
                with open(consistency_log_path, 'r') as f:
                    consistency_data = json.load(f)
            else:
                consistency_data = {"session_id": session_id, "runs": []}
            
            # Add this run
            import datetime
            consistency_data["runs"].append({
                "timestamp": datetime.datetime.now().isoformat(),
                "score": final_score,
                "seed": args.seed,
                "model": MODEL_NAME,
                "temperature": MODEL_TEMPERATURE,
                "thinking_level": args.thinking_level
            })
            
            # Calculate statistics
            all_scores = [r["score"] for r in consistency_data["runs"]]
            if len(all_scores) > 1:
                median_score = compute_median_score(all_scores)
                variance = max(all_scores) - min(all_scores)
                consistency_data["statistics"] = {
                    "total_runs": len(all_scores),
                    "all_scores": all_scores,
                    "median_score": round(median_score, 1),
                    "min_score": min(all_scores),
                    "max_score": max(all_scores),
                    "variance": round(variance, 1),
                    "is_reliable": variance <= SCORE_VARIANCE_THRESHOLD
                }
                
                # Print consistency warning if variance is high
                if variance > SCORE_VARIANCE_THRESHOLD:
                    print(f"\n[⚠️ CONSISTENCY WARNING] Score variance is HIGH: {variance:.1f} points")
                    print(f"   Previous scores: {all_scores[:-1]}")
                    print(f"   Current score:   {final_score}")
                    print(f"   Median score:    {median_score:.1f}")
                    print(f"   Recommended: Use median score ({median_score:.1f}) for reporting")
                else:
                    print(f"\n[✓ CONSISTENCY OK] Score variance: {variance:.1f} points (threshold: {SCORE_VARIANCE_THRESHOLD})")
                    print(f"   Scores: {all_scores}")
            
            # Save consistency log
            with open(consistency_log_path, 'w') as f:
                json.dump(consistency_data, f, indent=2)
                
        except Exception as e:
            print(f"[WARNING] Consistency tracking failed: {e}")

        # Final Cost Details
        in_1 = response_1.usage_metadata.prompt_token_count if response_1.usage_metadata else 0
        out_1 = response_1.usage_metadata.candidates_token_count if response_1.usage_metadata else 0
        in_2 = response_2.usage_metadata.prompt_token_count if response_2.usage_metadata else 0
        out_2 = response_2.usage_metadata.candidates_token_count if response_2.usage_metadata else 0
        
        total_in = in_1 + in_2
        total_out = out_1 + out_2
        
        total_cost = (total_in / 1e6 * COST_PER_MILLION_INPUT_TOKENS) + (total_out / 1e6 * COST_PER_MILLION_OUTPUT_TOKENS)
        print(f"Analysis complete. Total Tokens: {total_in + total_out}")
        print(f"Step 1: In={in_1}, Out={out_1}")
        print(f"Step 2: In={in_2}, Out={out_2}")
        print(f"Total Cost: ${total_cost:.4f}")

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
    parser.add_argument("--thinking_level", type=str, default=DEFAULT_THINKING_LEVEL, help="Thinking level for Gemini 3 (minimal, low, high)")
    parser.add_argument("--media_resolution", type=str, default=DEFAULT_MEDIA_RESOLUTION, choices=["MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"], help="Media resolution for vision processing (impacts token usage and latency)")
    parser.add_argument("--max_output_tokens", type=int, default=DEFAULT_MAX_OUTPUT_TOKENS, help="Maximum output tokens (None = model default)")
    parser.add_argument("--consistency_runs", type=int, default=DEFAULT_CONSISTENCY_RUNS, help="Number of analysis runs for consistency (1=single run, 3=high reliability)")
    parser.add_argument("--use_google_search", action="store_true", help="Enable Google Search grounding (Community Search) for factual verification")
    args = parser.parse_args()
    
    # Print configuration for reproducibility tracking
    print(f"=== CONFIGURATION ===")
    print(f"Model: {MODEL_NAME}")
    print(f"Temperature: {MODEL_TEMPERATURE} | Top_P: {MODEL_TOP_P} | Top_K: {MODEL_TOP_K}")
    print(f"Seed: {args.seed}")
    print(f"Thinking Level: {args.thinking_level}")
    print(f"Media Resolution: {args.media_resolution}")
    print(f"Consistency Runs: {args.consistency_runs}")
    print(f"Google Search: {args.use_google_search}")
    print(f"=====================")
    
    perform_rag_analysis(args.input, args.output_report, args.transcript)